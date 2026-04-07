/**
 * CSS sanitizer for inline `style` attributes, `<style>` tag content, and
 * the visual's custom-stylesheet setting.
 *
 * Uses postcss to parse the input into a structured AST, walks declarations
 * and at-rules, drops anything that violates the rule set, and re-serializes
 * the survivors. Replaces the regex-based cssDangerousPatterns check that
 * was insufficient for the MS 2026-04 cert finding.
 *
 * Two modes:
 *  - 'declaration-list' is for inline `style` attribute values. The input is
 *    a bag of declarations (no selectors, no at-rules at the top level).
 *  - 'stylesheet' is for `<style>` tag content and the custom-stylesheet
 *    setting. The input is a full stylesheet that may contain rules,
 *    at-rules, comments, etc.
 *
 * Both modes apply the same declaration-level rules (defined in subsequent
 * tasks). Stylesheet mode additionally enforces an at-rule allowlist and
 * selector-level checks. See docs/sanitization-rules.md for the full rule
 * set, and docs/superpowers/specs/2026-04-07-csp-sanitization-hardening-design.md
 * for the design rationale.
 */

import postcss, { Root, Declaration } from 'postcss';
import valueParser, { Node as ValueNode, FunctionNode } from 'postcss-value-parser';

const ALLOWED_AT_RULES = new Set<string>([
    'media',
    'supports',
    'keyframes',
    '-webkit-keyframes',
    'font-feature-values',
    'page'
]);

const DANGEROUS_SCHEME_PATTERNS: RegExp[] = [
    /javascript\s*:/i,
    /vbscript\s*:/i,
    /livescript\s*:/i,
    /mocha\s*:/i,
    /data\s*:\s*text\/html/i,
    /data\s*:\s*text\/javascript/i,
    /data\s*:\s*application\/javascript/i,
    /data\s*:\s*application\/x-javascript/i,
    /data\s*:\s*image/i
];

function hasDangerousSchemeInValue(value: string): boolean {
    // Strip url(...) tokens first — they are handled by the url() walker
    // in hasUnsafeUrl, and safe image data URIs inside url() must not
    // trip the bare-scheme check (e.g. url(data:image/png;base64,...)).
    //
    // The [^)]* pattern does not handle escaped or nested closing parens
    // inside the url argument (CSS allows `url(foo\))` and `url("a)b")`).
    // That's acceptable because any dangerous content inside the url()
    // token is already caught by the postcss-value-parser AST walk in
    // hasUnsafeUrl — this pre-strip is only a false-positive guard for
    // the scheme regex, not a source of truth for safety.
    const stripped = value.replace(/url\s*\([^)]*\)/gi, '');
    return DANGEROUS_SCHEME_PATTERNS.some(p => p.test(stripped));
}

function hasDangerousSelector(selector: string): boolean {
    if (/javascript\s*:/i.test(selector)) return true;
    for (let i = 0; i < selector.length; i++) {
        const code = selector.charCodeAt(i);
        if (code >= 0x00 && code <= 0x1f) return true;
    }
    return false;
}

const SAFE_IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/bmp'
]);

const URL_CONTAINER_FUNCTIONS = new Set([
    'linear-gradient',
    'radial-gradient',
    'conic-gradient',
    'repeating-linear-gradient',
    'repeating-radial-gradient',
    'repeating-conic-gradient',
    'image-set',
    '-webkit-image-set',
    'cross-fade',
    '-webkit-cross-fade'
]);

function extractUrlArgument(node: FunctionNode): string {
    const child = node.nodes.find(n => n.type === 'word' || n.type === 'string');
    if (!child) return '';
    return String((child as any).value || '').trim();
}

function isSafeImageDataUri(rawUrl: string): boolean {
    const url = rawUrl.trim().toLowerCase();
    if (!url) return false;
    if (!url.startsWith('data:')) return false;
    const semi = url.indexOf(';');
    const comma = url.indexOf(',');
    const end = Math.min(
        semi === -1 ? url.length : semi,
        comma === -1 ? url.length : comma
    );
    const mime = url.slice(5, end);
    if (mime === 'image/svg+xml') return false;
    return SAFE_IMAGE_MIME_TYPES.has(mime);
}

function hasUnsafeUrl(nodes: ValueNode[]): boolean {
    for (const node of nodes) {
        if (node.type !== 'function') continue;
        const fn = node as FunctionNode;
        const name = fn.value.toLowerCase();
        if (name === 'url') {
            const arg = extractUrlArgument(fn);
            if (!isSafeImageDataUri(arg)) {
                return true;
            }
            continue;
        }
        if (URL_CONTAINER_FUNCTIONS.has(name)) {
            if (hasUnsafeUrl(fn.nodes)) {
                return true;
            }
        }
    }
    return false;
}

export type SanitizeCssMode = 'declaration-list' | 'stylesheet';

/**
 * Sanitize a CSS input string and return the cleaned output. On parse
 * failure the input is dropped entirely (returns an empty string) and a
 * warning is emitted via console.warn — partial recovery from a malformed
 * input is too risky.
 */
export function sanitizeCss(input: string, mode: SanitizeCssMode): string {
    if (input == null || input === '') {
        return '';
    }
    let root: Root;
    try {
        const wrapped =
            mode === 'declaration-list' ? `__sanitize__{${input}}` : input;
        root = postcss.parse(wrapped);
    } catch (err) {
        console.warn(
            `sanitizeCss: parse failure, dropping input. ${(err as Error).message}`
        );
        return '';
    }

    root.walkAtRules(atRule => {
        if (!ALLOWED_AT_RULES.has(atRule.name.toLowerCase())) {
            atRule.remove();
        }
    });

    if (mode === 'stylesheet') {
        root.walkRules(rule => {
            if (hasDangerousSelector(rule.selector)) {
                rule.remove();
            }
        });
    }

    root.walkDecls((decl: Declaration) => {
        if (isDangerousDeclaration(decl)) {
            decl.remove();
        }
    });

    if (mode === 'declaration-list') {
        const synthetic = root.first;
        if (!synthetic || synthetic.type !== 'rule') {
            return '';
        }
        return synthetic.nodes
            .map(n => n.toString())
            .join('')
            .trim();
    }

    return root.toString();
}

/**
 * Drop any declaration whose value contains a `url()` token — at any
 * nesting depth — whose argument is not an allowlisted image data URI.
 *
 * The value is parsed into a postcss-value-parser AST and walked via
 * `hasUnsafeUrl`, which recurses into gradient, image-set, and cross-fade
 * functions (and their `-webkit-` variants) to catch url() tokens nested
 * inside them. CSS custom properties (`--foo`) are covered because the
 * walker operates on decl.value, which postcss populates the same way
 * for custom properties as for standard ones.
 *
 * If postcss-value-parser fails to parse the value, the declaration is
 * dropped as a safe default.
 *
 * Tasks 11-13 will add at-rule allowlisting, non-url() scheme variants
 * (javascript:/vbscript:/blob:), denied function checks (expression,
 * -moz-binding, behavior), and the defense-in-depth final pass.
 */
function isDangerousDeclaration(decl: Declaration): boolean {
    const value = decl.value;
    if (!value) return false;
    if (hasDangerousSchemeInValue(value)) return true;
    if (!/url\s*\(/i.test(value)) return false;

    let parsed;
    try {
        parsed = valueParser(value);
    } catch {
        return true;
    }
    return hasUnsafeUrl(parsed.nodes);
}
