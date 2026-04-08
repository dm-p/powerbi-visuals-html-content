import powerbiVisualsConfigs from 'eslint-plugin-powerbi-visuals';

export default [
    powerbiVisualsConfigs.configs.recommended,
    {
        ignores: [
            'bin/**',
            'scripts/**',
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
