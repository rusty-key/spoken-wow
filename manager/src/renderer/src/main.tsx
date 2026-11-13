import '@fontsource/noto-sans/latin-400.css'
import '@fontsource/noto-sans/latin-ext-400.css'
import '@fontsource/noto-sans/cyrillic-400.css'
import '@fontsource/noto-sans/latin-600.css'
import '@fontsource/noto-sans/latin-ext-600.css'
import '@fontsource/noto-sans/cyrillic-600.css'
import '@fontsource/noto-sans/latin-700.css'
import '@fontsource/noto-sans/latin-ext-700.css'
import '@fontsource/noto-sans/cyrillic-700.css'
import '@fontsource/cinzel/latin-600.css'
import '@fontsource/cinzel/latin-700.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadApi } from './api'
import { StoreProvider } from './store'
import './styles.css'

void loadApi().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StoreProvider>
      <App />
    </StoreProvider>
  )
})
