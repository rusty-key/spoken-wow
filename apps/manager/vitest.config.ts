import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@site-contributions': resolve(__dirname, '../web/src/lib/contributions')
    }
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' }
})
