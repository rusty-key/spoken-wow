import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const shared = resolve(__dirname, 'src/shared')
// The site's reader of the addon's saved variables file, used as it is so both read it alike.
const siteContributions = resolve(__dirname, '../apps/web/src/lib/contributions')
// The site's remote worker protocol, so the Manager and a browser tab generate alike.
const siteWorker = resolve(__dirname, '../apps/web/src/lib/worker')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared, '@site-contributions': siteContributions, '@site-worker': siteWorker } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': shared } },
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } }
  }
})
