import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['.cursor/scripts/**/*.test.ts'],
    environment: 'node',
  },
});
