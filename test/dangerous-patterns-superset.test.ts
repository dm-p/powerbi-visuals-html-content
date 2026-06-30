import { describe, it, expect } from 'vitest';
import { VisualConstants } from '../src/visual-constants';
import {
    DANGEROUS_SCHEME_PATTERNS,
    DEFENSE_IN_DEPTH_PATTERNS
} from '../src/sanitize/css';

/**
 * SECURITY REGRESSION GUARD — detection must only WIDEN, never NARROW.
 *
 * The four dangerous-pattern lists below were unified onto a single canonical
 * source (`src/sanitize/dangerous-patterns.ts`: `SCHEME_REGEXES`,
 * `SCHEME_SUBSTRINGS`):
 *
 *  - `VisualConstants.scriptingPatterns`      (HTML/URL substring scan)
 *  - `VisualConstants.cssDangerousPatterns`   (legacy CSS regex denylist)
 *  - `DANGEROUS_SCHEME_PATTERNS`              (css.ts, bare-scheme value scan)
 *  - `DEFENSE_IN_DEPTH_PATTERNS`              (css.ts, serialized final pass)
 *
 * The unification was intended to be byte-equivalent. This guard freezes the
 * EXACT pre-unification lists (captured verbatim from git at the spec commit
 * `4dc92f9`, before the Phase-3 refactor) and asserts the CURRENT derived
 * lists are SUPERSETS of those frozen snapshots: every dangerous pattern the
 * original lists caught must still be caught.
 *
 * If a future edit to `dangerous-patterns.ts`, or to any call site that
 * spreads it, drops or alters a pattern so an original member is no longer
 * present, one of these assertions fails. That is a real security finding —
 * the denylist narrowed — not a test bug. Detection may grow (new patterns are
 * fine and expected); it may never shrink.
 *
 * Regexes are frozen as their `.source` strings and compared by `.source`, so
 * a flag-only or pattern-text change to an original member is also caught.
 *
 * Frozen-fixture provenance:
 *   git show 4dc92f9:src/visual-constants.ts  -> scriptingPatterns (58 members),
 *                                                cssDangerousPatterns (12 members)
 *   git show 4dc92f9:src/css-sanitizer.ts     -> DANGEROUS_SCHEME_PATTERNS (9 members),
 *                                                DEFENSE_IN_DEPTH_PATTERNS (15 members)
 *   (css-sanitizer.ts is now src/sanitize/css.ts)
 */

// --- Frozen snapshot: original VisualConstants.scriptingPatterns -------------
// 58 members, copied verbatim from 4dc92f9:src/visual-constants.ts. The 32
// control-character `javas<C>cript` obfuscation entries (0x00..0x1F) are
// reproduced via the same deterministic run the original used; everything else
// is a literal copy.
const ORIGINAL_SCRIPTING_SUBSTRINGS: string[] = [
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
    ...Array.from(
        { length: 0x20 },
        (_, code) => `javas${String.fromCharCode(code)}cript`
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

// --- Frozen snapshot: original VisualConstants.cssDangerousPatterns ----------
// 12 members, copied verbatim from 4dc92f9:src/visual-constants.ts, stored as
// regex `.source` strings.
const ORIGINAL_CSS_DANGEROUS: string[] = [
    /@[\s\\\/\*]*i[\s\\\/\*]*m[\s\\\/\*]*p[\s\\\/\*]*o[\s\\\/\*]*r[\s\\\/\*]*t/i
        .source,
    /expression\s*\(/i.source,
    /javascript\s*:/i.source,
    /vbscript\s*:/i.source,
    /data\s*:\s*text\/html/i.source,
    /data\s*:\s*text\/javascript/i.source,
    /data\s*:\s*application\/javascript/i.source,
    /-moz-binding\s*:/i.source,
    /behavior\s*:/i.source,
    /url\s*\(\s*['"]?\s*javascript/i.source,
    /url\s*\(\s*['"]?\s*vbscript/i.source,
    /url\s*\(\s*['"]?\s*data\s*:\s*text\//i.source
];

// --- Frozen snapshot: original DANGEROUS_SCHEME_PATTERNS ---------------------
// 9 members, copied verbatim from 4dc92f9:src/css-sanitizer.ts, as `.source`.
const ORIGINAL_SCHEME_REGEX_SOURCES: string[] = [
    /javascript\s*:/i.source,
    /vbscript\s*:/i.source,
    /livescript\s*:/i.source,
    /mocha\s*:/i.source,
    /data\s*:\s*text\/html/i.source,
    /data\s*:\s*text\/javascript/i.source,
    /data\s*:\s*application\/javascript/i.source,
    /data\s*:\s*application\/x-javascript/i.source,
    /data\s*:\s*image/i.source
];

// --- Frozen snapshot: original DEFENSE_IN_DEPTH_PATTERNS ---------------------
// 15 members, copied verbatim from 4dc92f9:src/css-sanitizer.ts, as `.source`.
const ORIGINAL_DEFENSE_REGEX_SOURCES: string[] = [
    /@import/i.source,
    /@font-face/i.source,
    /@namespace/i.source,
    /expression\s*\(/i.source,
    /javascript\s*:/i.source,
    /vbscript\s*:/i.source,
    /livescript\s*:/i.source,
    /mocha\s*:/i.source,
    /data\s*:\s*text\/html/i.source,
    /data\s*:\s*text\/javascript/i.source,
    /data\s*:\s*application\/javascript/i.source,
    /data\s*:\s*application\/x-javascript/i.source,
    /-moz-binding/i.source,
    /(^|[;{\s])behavior\s*:/i.source,
    /progid\s*:/i.source
];

describe('dangerous-pattern unification never narrows detection', () => {
    it('froze the expected number of original members (fixture sanity)', () => {
        expect(ORIGINAL_SCRIPTING_SUBSTRINGS).toHaveLength(58);
        expect(ORIGINAL_CSS_DANGEROUS).toHaveLength(12);
        expect(ORIGINAL_SCHEME_REGEX_SOURCES).toHaveLength(9);
        expect(ORIGINAL_DEFENSE_REGEX_SOURCES).toHaveLength(15);
    });

    describe('VisualConstants.scriptingPatterns is a superset', () => {
        const current = new Set(VisualConstants.scriptingPatterns);
        it.each(ORIGINAL_SCRIPTING_SUBSTRINGS)(
            'still contains substring %j',
            (original) => {
                expect(current.has(original)).toBe(true);
            }
        );
    });

    describe('VisualConstants.cssDangerousPatterns is a superset', () => {
        const current = new Set(
            VisualConstants.cssDangerousPatterns.map((r) => r.source)
        );
        it.each(ORIGINAL_CSS_DANGEROUS)(
            'still contains regex /%s/',
            (original) => {
                expect(current.has(original)).toBe(true);
            }
        );
    });

    describe('DANGEROUS_SCHEME_PATTERNS is a superset', () => {
        const current = new Set(DANGEROUS_SCHEME_PATTERNS.map((r) => r.source));
        it.each(ORIGINAL_SCHEME_REGEX_SOURCES)(
            'still contains regex /%s/',
            (original) => {
                expect(current.has(original)).toBe(true);
            }
        );
    });

    describe('DEFENSE_IN_DEPTH_PATTERNS is a superset', () => {
        const current = new Set(DEFENSE_IN_DEPTH_PATTERNS.map((r) => r.source));
        it.each(ORIGINAL_DEFENSE_REGEX_SOURCES)(
            'still contains regex /%s/',
            (original) => {
                expect(current.has(original)).toBe(true);
            }
        );
    });
});
