// Opa! Tulik — turns pasted invoice/receipt text into a draft transaction
// (date, merchant, amount, and a best-guess category from the household's
// own category list) using Claude. Nothing here writes to the database —
// TransactionsView.ts always shows the result as an editable draft in the
// Add Transaction modal before the user saves it.
//
// Auth: Supabase verifies the caller's JWT before this runs (the default
// for Edge Functions), so only a signed-in household member can call it —
// the same protection the RLS policies give the tables themselves.
//
// Deploy:
//   supabase functions deploy parse-invoice
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Get a key at https://console.anthropic.com — this calls the Anthropic
// API directly (a small cost per paste, no separate SDK dependency needed
// since this is just one HTTPS request).

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

interface CategoryOption {
  id: string
  name: string
}

interface ParseRequest {
  text: string
  categories: CategoryOption[]
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  let body: ParseRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400)
  }

  const text = body.text?.trim()
  if (!text) return jsonResponse({ error: 'No text provided.' }, 400)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY is not configured on this function.' }, 500)

  const categoryList = (body.categories ?? []).map((c) => `${c.id}: ${c.name}`).join('\n') || '(no categories available)'

  let anthropicResponse: Response
  try {
    anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content:
              `Extract the transaction details from this invoice/receipt text (it may be in Hebrew or English). ` +
              `Pick the single best-matching category id from this list, or null if none fit well:\n${categoryList}\n\n` +
              `Text:\n"""\n${text}\n"""`,
          },
        ],
        tools: [
          {
            name: 'extract_invoice',
            description: 'Records the extracted transaction fields.',
            input_schema: {
              type: 'object',
              properties: {
                date: { type: ['string', 'null'], description: 'ISO yyyy-mm-dd, or null if not found in the text' },
                merchant: { type: ['string', 'null'], description: 'Business/payee name, or null if not found' },
                amount: { type: ['number', 'null'], description: 'Total amount as a plain number (no currency symbol), or null if not found' },
                categoryId: { type: ['string', 'null'], description: 'Best-matching category id from the provided list, or null' },
              },
              required: ['date', 'merchant', 'amount', 'categoryId'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'extract_invoice' },
      }),
    })
  } catch (err) {
    return jsonResponse({ error: `Could not reach the AI service: ${err instanceof Error ? err.message : String(err)}` }, 502)
  }

  if (!anthropicResponse.ok) {
    const detail = await anthropicResponse.text()
    return jsonResponse({ error: `AI service error (${anthropicResponse.status}): ${detail}` }, 502)
  }

  const data = await anthropicResponse.json()
  const toolUse = data.content?.find((block: { type: string }) => block.type === 'tool_use')
  if (!toolUse) return jsonResponse({ error: 'Could not extract a transaction from that text.' }, 422)

  return jsonResponse(toolUse.input)
})
