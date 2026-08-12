import { describe, it, expect } from 'vitest';
import {
    SCHEME_REGEXES,
    SCHEME_SUBSTRINGS
} from '../src/sanitize/dangerous-patterns';

/**
 * These tests pin the canonical dangerous-scheme source of truth. They are
 * deliberately strict about whitespace tolerance: the scheme regexes carry
 * `\s*` between the scheme name and the colon (and inside `data:` MIME types).
 * If a future edit narrows those patterns (a security regression), the
 * "spaces around the colon" assertions below will fail.
 */

function matchesAny(regexes: RegExp[], input: string): boolean {
    // Use fresh tests; none of the canonical regexes are global/sticky, so
    // lastIndex carryover is not a concern, but be explicit.
    return regexes.some((re) => re.test(input));
}

describe('SCHEME_REGEXES', () => {
    const cases: Array<[string, string]> = [
        ['javascript:', 'javascript:alert(1)'],
        ['vbscript:', 'vbscript:msgbox(1)'],
        ['livescript:', 'livescript:foo'],
        ['mocha:', 'mocha:foo'],
        ['data:text/html', 'data:text/html,<script>'],
        ['data:text/javascript', 'data:text/javascript,alert(1)'],
        ['data:application/javascript', 'data:application/javascript,alert(1)'],
        [
            'data:application/x-javascript',
            'data:application/x-javascript,alert(1)'
        ]
    ];

    it.each(cases)('matches %s', (_label, input) => {
        expect(matchesAny(SCHEME_REGEXES, input)).toBe(true);
    });

    it('preserves whitespace tolerance: matches spaces around the colon', () => {
        // Proves the `\s*`-bearing literal was copied, not a narrowed variant.
        expect(matchesAny(SCHEME_REGEXES, 'data : text/html')).toBe(true);
        expect(matchesAny(SCHEME_REGEXES, 'javascript : alert(1)')).toBe(true);
    });
});

describe('SCHEME_SUBSTRINGS', () => {
    it('includes the bare and spaced javascript scheme forms', () => {
        expect(SCHEME_SUBSTRINGS).toContain('javascript:');
        expect(SCHEME_SUBSTRINGS).toContain('javascript :');
    });

    it('includes a control-char obfuscation variant', () => {
        expect(SCHEME_SUBSTRINGS).toContain('javas\x00cript');
        expect(SCHEME_SUBSTRINGS).toContain('javas\x1Fcript');
    });
});
