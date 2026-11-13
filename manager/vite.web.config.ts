// Runs the window in a normal browser with a fake ManagerApi (src/renderer/src/mock/api.ts).
// Used for design work: `npm run dev:web`, then open http://localhost:5173.
// Add ?offline=1 or ?empty=1 to the address to see those states.
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  plugins: [
    react(),
    {
      // The dev server injects an inline script for hot reload, which the strict CSP in
      // index.html would block. The CSP stays in the built page.
      name: 'web-dev-no-csp',
      apply: 'serve',
      transformIndexHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
    }
  ],
  server: { port: 5173, strictPort: true },
  build: { outDir: resolve(__dirname, 'out/web'), emptyOutDir: true }
})
