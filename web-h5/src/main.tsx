import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { api } from '@/api'
import { installErrorMonitoring } from '@/utils/errorMonitoring'
import App from './App.tsx'
import { I18nProvider } from './i18n.tsx'

installErrorMonitoring(report => api.monitoring.reportClientError(report))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
