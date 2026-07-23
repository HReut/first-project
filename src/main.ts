import './style.css'
import { mountDashboard } from './components/Dashboard.ts'

mountDashboard(document.querySelector<HTMLDivElement>('#app')!)
