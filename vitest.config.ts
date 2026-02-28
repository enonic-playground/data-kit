import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react()],
    test: {
        include: ['src/test/**/*.test.{ts,tsx}'],
        environment: 'node',
        setupFiles: ['./src/test/setup-dom.ts'],
        passWithNoTests: true,
    },
});
