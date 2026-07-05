import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['.trae/scripts/**/*.test.ts'],
    environment: 'node',
  },
});
