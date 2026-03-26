import powerbiVisualsConfigs from 'eslint-plugin-powerbi-visuals';

export default [
    powerbiVisualsConfigs.configs.recommended,
    {
        ignores: [
            'bin/**',
            'node_modules/**',
            'dist/**',
            'coverage/**',
            'test/**',
            '.vscode/**',
            '.tmp/**',
            'vitest.config.ts'
        ]
    }
];
