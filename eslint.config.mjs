import powerbiVisualsConfigs from 'eslint-plugin-powerbi-visuals';
import jsdoc from 'eslint-plugin-jsdoc';

// Top-level declaration contexts (direct children of Program, exported or not).
// require-jsdoc fires when any of these lacks an attached /** */ block — this is
// what enforces "all top-level declarations carry a hover-doc". No @param/@returns
// rules are enabled: a plain /** description */ satisfies it. In-body and nested
// declarations are intentionally excluded (those stay // line comments).
//
// Exported declarations are matched on the OUTER ExportNamedDeclaration, not the
// inner declaration: a leading /** */ block sits before the `export` keyword and
// attaches to the outer node, so selecting the inner VariableDeclaration would make
// the plugin miss the block and flag it as undocumented. `[declaration]` excludes
// bare `export { … }` / `export type { … }` re-exports (nothing to document).
const topLevelDecls = [
    ...[
        'VariableDeclaration',
        'FunctionDeclaration',
        'ClassDeclaration',
        'TSTypeAliasDeclaration',
        'TSInterfaceDeclaration',
        'TSEnumDeclaration'
    ].map((d) => `Program > ${d}`),
    'Program > ExportNamedDeclaration[declaration]'
];

export default [
    powerbiVisualsConfigs.configs.recommended,
    {
        files: ['src/**/*.ts'],
        ignores: ['src/**/*.generated.ts', 'src/**/*.d.ts'],
        plugins: { jsdoc },
        rules: {
            // `require` defaults (notably FunctionDeclaration) are disabled so ONLY
            // the top-level `contexts` drive the rule — otherwise nested in-body
            // functions get flagged and top-level ones double-report.
            'jsdoc/require-jsdoc': [
                'error',
                {
                    require: {
                        FunctionDeclaration: false,
                        ClassDeclaration: false,
                        MethodDefinition: false,
                        ArrowFunctionExpression: false,
                        FunctionExpression: false
                    },
                    contexts: topLevelDecls
                }
            ]
        }
    },
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
