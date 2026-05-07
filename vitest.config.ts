import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react()],
    test: {
        include: ['src/test/**/*.test.{ts,tsx}'],
        environment: 'node',
        setupFiles: ['./src/test/setup-dom.ts', './src/test/setup-i18n.ts'],
        passWithNoTests: true,
    },
});
