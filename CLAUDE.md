# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies
npm run dev       # start the Vite dev server
npm run build     # tsc (type-check) && vite build — this is the only type-check step, there's no separate `lint`/`typecheck` script
npm run preview   # preview the production build locally
```

There is no test suite/framework configured in this repo currently.

## What this is

"Opa! Tulik" — a household expense tracker. Client-only Vite + TypeScript SPA (no framework — no React/Vue/etc., just hand-rolled DOM via template-string `innerHTML`), optionally backed by Supabase.

## Architecture

### Dual-mode data layer (Supabase-or-local)

`src/lib/supabaseClient.ts` exports `supabase` (a client or `null`) and `isSupabaseConfigured`, derived from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (`.env`, gitignored; see `.env.example`). Every repo in `src/data/*Repo.ts` (`categoriesRepo`, `transactionsRepo`, `emailRulesRepo`) checks `supabase` and either hits the real table or falls back to a localStorage-backed mock store (`src/data/localStore.ts`), so the app is fully usable with zero setup and starts talking to Supabase the moment `.env` is filled in — no code changes needed at that point.

- DB schema lives in `supabase/migrations/0001_init.sql` (run manually in the Supabase SQL editor — there's no migration runner wired up). It seeds 8 default categories.
- `src/data/localStore.ts` seeds the same 8 categories (`src/data/mockCategories.ts`) plus a deterministic mock transaction history (`src/data/mockTransactions.ts`, seeded PRNG so the dataset is stable across reloads) the first time it's read. **If you change the category seed or table schema, update both the SQL migration and the local mock seed** — they're two independent copies, not generated from one source.
- Row shapes are snake_case and live in `src/types/database.ts` (`CategoryRow`, `TransactionRow`, `EmailSyncRuleRow`), matching the SQL exactly. Domain types are camelCase and live in `src/types.ts` (`Category`, `Transaction`, `EmailSyncRule`). Each repo has `fromRow`/`toRow` mappers — components only ever see the camelCase domain types.
- RLS is enabled on all tables with a permissive "allow all" policy (no auth in this app) — see the comment in the migration before tightening it.

### State

`src/state/store.ts` is a ~20-line generic pub-sub `Store<T>` (`getState`/`setState`/`subscribe`) — the only state primitive in the app, no Redux/Zustand/etc. `src/components/App.ts` creates the single `Store<AppState>` (shape defined in `src/types.ts`), boots it by fetching categories/transactions/email rules in parallel from the repos (`status: 'loading' | 'ready' | 'error'`), and passes the store down to each view mounter.

### Views / components

`src/components/App.ts` renders the topbar + nav and mounts the four views (`src/components/views/*View.ts`) into hidden/shown `<section>`s, keyed off `location.hash` (`#overview`, `#transactions`, `#insights`, `#settings`). Each view module exports a `mount*View(container, store)` function that owns its subtree: renders the initial DOM once, subscribes to the store, and either re-renders via a class instance (e.g. `TransactionsView`, `CategoryBreakdown`) or a closured `render(state)` function.

Reusable pieces live under `src/components/shared/` (`Modal`, `ProgressBar`, `transactionCells` — the read-only merchant/category/person/status cell renderers shared between Overview and Transactions) and `src/components/icons/` (hand-drawn SVG markup, no icon library).

`TransactionsView` is the most involved component: it owns local (non-store) UI state for sort column/direction and bulk-selection, does Monday.com-style inline cell editing (click a cell → swap in an `<input>`/`<select>` → commit on blur/change/Enter, revert on Escape), and drives everything through a single delegated listener per event type rather than per-row listeners.

### Domain model quirks worth knowing

- `Person` is a fixed literal union `'Reut' | 'Keren'` — not user-configurable. There's no "people settings" screen.
- `Category` is fully dynamic (DB-backed, user-editable in Settings' category manager) — there's no fixed `Category` union/enum. Category color comes from each row's `colorCode` and is applied via an inline CSS custom property (`style="--tile-color: ..."`), not a fixed set of `--cat-N` classes.
- `computeMonthlyInsights`/`computeCategoryBreakdown`/`computeSplitBalance` (`src/utils/insights.ts`) always compare "this calendar month vs. last calendar month" regardless of the Transactions view's period filter — Overview's KPIs are intentionally the unfiltered household pulse, not scoped to whatever filter is active on the Transactions page.

### Styling

Single `src/style.css`, no CSS framework/modules. Theming is CSS custom properties on `:root`, redefined under `@media (prefers-color-scheme: dark)` — no JS theme toggle. Layout uses a repeated "band" pattern (`.band` / `.band__inner`, full-bleed alternating-background sections with a max-width inner column) plus card surfaces (`--surface` on `--bg`) for an Apple-inspired look. Categorical/status colors were chosen to pass colorblind-safe contrast checks — don't tweak the palette hex values casually.

**Known gotcha**: don't add an unconditional `display` to a class also toggled via the `hidden` attribute — author CSS beats the UA `[hidden] { display: none }` rule at equal specificity, so the element stays visible. Add an explicit `.foo[hidden] { display: none }` override when this pattern is needed (see `.bulk-bar[hidden]`, `.filter-group[hidden]` in `style.css`).

### TypeScript config notes (`tsconfig.json`)

- `verbatimModuleSyntax: true` — type-only imports must use `import type { ... }`.
- Module resolution is `bundler` with `allowImportingTsExtensions: true` — internal imports use explicit `.ts` extensions (e.g. `from '../types.ts'`).
- `erasableSyntaxOnly` — no TS `enum`s or other constructs that need runtime emission; unions/literal types are used instead.
- `noUnusedLocals` / `noUnusedParameters` are on — an unused import will fail `npm run build`.
