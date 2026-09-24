import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { MicroserviceProvider } from './context/IncidentContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MicroserviceProvider>
      <App />
    </MicroserviceProvider>
  </StrictMode>,
)
