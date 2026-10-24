import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'virtual:syncnos-katex-shadow-css': `${path.resolve('node_modules/katex/dist/katex.min.css')}?inline`,
      '@ui': path.resolve('src/ui'),
      '@viewmodels': path.resolve('src/viewmodels'),
      '@services': path.resolve('src/services'),
      '@platform': path.resolve('src/platform'),
      '@collectors': path.resolve('src/collectors'),
      '@entrypoints': path.resolve('src/entrypoints'),
      '@i18n': path.resolve('src/ui/i18n'),
    },
  },
  test: {
    environment: 'node',
    // Exercise the real processed KaTeX shadow stylesheet instead of Vitest's empty CSS stub.
    css: { include: [/katex[\\/]dist[\\/]katex\.min\.css\?inline/] },
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup-nodefilter.ts'],
  },
});
