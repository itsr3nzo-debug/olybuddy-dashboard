import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Vitest config (item #7). Scope: pure-logic helpers under lib/. Anything
 * that needs a Supabase or Stripe live connection lives in
 * tests/integration/ which is OFF by default — opt in via TEST_INTEGRATION=1.
 *
 * Aliases mirror tsconfig.json so `@/lib/...` resolves the same way it
 * does in Next.js code.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'lib/**/*.test.ts', 'app/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'tests/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/**', '.next/**', 'app/**/page.tsx', 'app/**/layout.tsx',
        'components/**', 'tests/**', 'public/**', '**/*.config.*',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
