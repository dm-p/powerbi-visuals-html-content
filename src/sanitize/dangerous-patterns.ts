/**
 * Canonical source of truth for dangerous-scheme / scripting patterns used by
 * the sanitizer. This module is DATA-ONLY: it has no consumers and no runtime
 * behavior of its own. Call sites import these constants and spread them
 * together with their own context-specific extras:
 *
 *  - The CSS value scan (`hasDangerousSchemeInValue` in `sanitize/css.ts`)
 *    spreads `SCHEME_REGEXES` and adds `/data\s*:\s*image/i`.
 *  - The defense-in-depth final pass (`DEFENSE_IN_DEPTH_PATTERNS` in
 *    `sanitize/css.ts`) spreads `SCHEME_REGEXES` and adds the at-rule
 *    patterns (`@import`, `@font-face`, `@namespace`, `expression\s*\(`) plus
 *    `-moz-binding`, `(^|[;{\s])behavior\s*:`, and `progid\s*:`.
 *  - The HTML/URL substring scan (`scriptingPatterns` in `visual-constants.ts`)
 *    uses `SCHEME_SUBSTRINGS`.
 *
 * SECURITY-CRITICAL: the scheme regexes below were COPIED VERBATIM
 * (character-for-character, identical flags) from the two parallel lists in
 * `sanitize/css.ts` (`DANGEROUS_SCHEME_PATTERNS` and
 * `DEFENSE_IN_DEPTH_PATTERNS`), where they appeared identically. They carry
 * deliberate whitespace tolerance (`\s*` around colons and inside `data:`
 * MIME types). Do NOT regenerate them from strings — that risks producing a
 * narrower pattern and a silent security regression. If you change one, change
 * the comment too and re-verify against both original lists.
 */

/**
 * The shared dangerous-scheme regexes. These appeared, byte-for-byte
 * identical, in BOTH `DANGEROUS_SCHEME_PATTERNS` and
 * `DEFENSE_IN_DEPTH_PATTERNS` in `sanitize/css.ts`. They are reproduced here
 * exactly once. Context-specific extras (e.g. `/data\s*:\s*image/i` for the
 * CSS value scan) are NOT included here — each call site adds its own.
 */
export const SCHEME_REGEXES: RegExp[] = [
    /javascript\s*:/i,
    /vbscript\s*:/i,
    /livescript\s*:/i,
    /mocha\s*:/i,
    /data\s*:\s*text\/html/i,
    /data\s*:\s*text\/javascript/i,
    /data\s*:\s*application\/javascript/i,
    /data\s*:\s*application\/x-javascript/i
];

/**
 * The substring forms of the dangerous-scheme / scripting denylist, currently
 * mirrored by `VisualConstants.scriptingPatterns`. Reproduced here so the HTML
 * substring scan can share one source of truth.
 *
 * The bulk of the list is written as explicit literals so it can be diffed
 * against the original verbatim. The ONE family produced by generation is the
 * control-character obfuscation set (`javas<C>cript` for every control char
 * 0x00..0x1F): it is a deterministic 32-member run and generation was verified
 * to reproduce the original literals exactly (same length, same members, same
 * order). Everything else is a literal copy.
 */
export const SCHEME_SUBSTRINGS: string[] = [
    // Bare and spaced scheme prefixes.
    'javascript:',
    'javascript :',
    'vbscript:',
    'vbscript :',
    'livescript:',
    'livescript :',
    'mocha:',
    'data:text/html',
    'data:text/javascript',
    'data:application/javascript',
    'data:application/x-javascript',
    // All control characters (0x00-0x1F) for javascript obfuscation.
    // Generated, verified identical to the original literal run.
    ...Array.from({ length: 0x20 }, (_, code) =>
        `javas${String.fromCharCode(code)}cript`
    ),
    // CSS-based attacks.
    'expression(',
    'expression (',
    '-moz-binding',
    'behavior:',
    'behavior :',
    // URL functions that can be dangerous.
    'url(javascript',
    'url( javascript',
    'url(data:text/html',
    'url( data:text/html',
    'url(data:text/javascript',
    'url( data:text/javascript',
    'url(data:application/',
    'url( data:application/',
    'url(vbscript',
    'url( vbscript'
];
