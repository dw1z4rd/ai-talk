import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '$lib': path.resolve(__dirname, 'src/lib'),
      '$env/static/private': path.resolve(__dirname, 'src/__mocks__/env-static-private.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
