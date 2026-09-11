import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Maps the "@/*" path alias (tsconfig.json) so tests can import app modules.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
