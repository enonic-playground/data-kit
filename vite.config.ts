import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type UserConfig } from 'vite';

const allowedTargets = ['js', 'css'] as const;
type BuildTarget = (typeof allowedTargets)[number];

const isBuildTarget = (target: string | undefined): target is BuildTarget =>
    allowedTargets.includes(target as BuildTarget);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
    const { BUILD_TARGET } = process.env;
    const target = isBuildTarget(BUILD_TARGET) ? BUILD_TARGET : 'js';

    const isProduction = mode === 'production';
    const isDevelopment = mode === 'development';

    const IN_PATH = path.join(__dirname, 'src/main/resources/assets');
    const OUT_PATH = path.join(__dirname, 'build/resources/main/assets');

    const CONFIGS: Record<BuildTarget, UserConfig> = {
        js: {
            ...(isProduction && { logLevel: 'warn' }),
            root: IN_PATH,
            base: './',
            plugins: [react()],
            build: {
                outDir: OUT_PATH,
                emptyOutDir: false,
                target: 'ES2023',
                minify: isProduction,
                sourcemap: isDevelopment,
                rollupOptions: {
                    input: {
                        'js/bundle': path.join(IN_PATH, 'js/app.tsx'),
                    },
                    output: {
                        format: 'es',
                        entryFileNames: '[name].js',
                        chunkFileNames: 'js/chunks/[name]-[hash].js',
                    },
                },
            },
            esbuild: {
                keepNames: true,
                treeShaking: true,
                ...(isProduction && {
                    legalComments: 'none',
                    drop: ['console', 'debugger'],
                }),
            },
        },
        css: {
            ...(isProduction && { logLevel: 'warn' }),
            root: IN_PATH,
            base: './',
            plugins: [tailwindcss()],
            build: {
                outDir: OUT_PATH,
                emptyOutDir: false,
                minify: isProduction,
                sourcemap: isDevelopment,
                rollupOptions: {
                    input: {
                        'styles/main': path.join(IN_PATH, 'styles/main.css'),
                    },
                    output: {
                        assetFileNames: (assetInfo) => {
                            const name = assetInfo.names?.[0] ?? '';
                            if (name.endsWith('.css')) return `styles/${path.basename(name)}`;
                            return '[name][extname]';
                        },
                    },
                },
            },
        },
    };

    return CONFIGS[target];
});
