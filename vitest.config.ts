import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./test/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'test/',
                '*.config.ts',
                'bin/',
                'dist/',
                '.tmp/'
            ]
        },
        include: ['test/**/*.test.ts'],
        exclude: ['node_modules', 'dist', '.tmp'],
        server: {
            deps: {
                inline: [
                    'powerbi-visuals-utils-typeutils',
                    'powerbi-visuals-utils-formattingutils',
                    'powerbi-visuals-utils-interactivityutils',
                    'powerbi-visuals-utils-tooltiputils'
                ]
            }
        },
        deps: {
            optimizer: {
                web: {
                    include: [
                        'powerbi-visuals-utils-typeutils',
                        'powerbi-visuals-utils-formattingutils',
                        'powerbi-visuals-utils-interactivityutils',
                        'powerbi-visuals-utils-tooltiputils'
                    ]
                }
            }
        }
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        },
        extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']
    }
});
