import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@site-contributions': resolve(__dirname, '../apps/web/src/lib/contributions'),
      '@site-worker': resolve(__dirname, '../apps/web/src/lib/worker')
    }
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' }
})
