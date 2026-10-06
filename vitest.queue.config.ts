import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: { environment: 'node', include: ['tests/continuous-queue/**/*.test.ts'], fileParallelism: false, testTimeout: 25_000, hookTimeout: 25_000 },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
