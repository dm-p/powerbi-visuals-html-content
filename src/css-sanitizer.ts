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
 * Both modes apply the same declaration-level rules: unsafe url() tokens
 * (scheme + MIME-type allowlist for images), bare dangerous schemes in
 * property values (javascript:/vbscript:/data:text-html/etc), denied CSS
 * functions (expression, -moz-binding, attr), and a property-name denylist
 * (behavior, -moz-binding, filter+progid:). Stylesheet mode additionally
 * enforces an at-rule allowlist and a selector filter. See
 * docs/sanitization-rules.md for the user-facing rule set, and
 * docs/superpowers/specs/2026-04-07-csp-sanitization-hardening-design.md
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

/**
 * Defense-in-depth patterns run against the final serialized output of
 * sanitizeCss, AFTER the postcss-based pipeline has finished. If any match,
 * the entire block is dropped. This is a safety net against parser escapes
 * we didn't anticipate — the parser-based rules are the primary defense,
 * these are belt and braces.
 *
 * Specifically catches content smuggled through CSS comments, which the
 * postcss walker preserves verbatim because comments are structurally legal.
 *
 * The `behavior:` pattern is anchored to a declaration boundary so it
 * doesn't false-positive on compound property names like `scroll-behavior`
 * or `overflow-behavior`.
 */
const DEFENSE_IN_DEPTH_PATTERNS: RegExp[] = [
    /@import/i,
    /@font-face/i,
    /@namespace/i,
    /expression\s*\(/i,
    /javascript\s*:/i,
    /vbscript\s*:/i,
    /livescript\s*:/i,
    /mocha\s*:/i,
    /data\s*:\s*text\/html/i,
    /data\s*:\s*text\/javascript/i,
    /data\s*:\s*application\/javascript/i,
    /data\s*:\s*application\/x-javascript/i,
    /-moz-binding/i,
    /(^|[;{\s])behavior\s*:/i,
    /progid\s*:/i
];

function finalPassIsClean(serialized: string): boolean {
    return !DEFENSE_IN_DEPTH_PATTERNS.some(p => p.test(serialized));
}

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

const DENIED_FUNCTIONS = new Set<string>([
    'expression',
    '-moz-binding',
    'attr'
]);

const DENIED_PROPERTY_NAMES = new Set<string>([
    'behavior',
    '-moz-binding'
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

function hasUnsafeFunction(nodes: ValueNode[]): boolean {
    for (const node of nodes) {
        if (node.type !== 'function') continue;
        const fn = node as FunctionNode;
        const name = fn.value.toLowerCase();
        if (DENIED_FUNCTIONS.has(name)) return true;
        if (name === 'url') {
            const arg = extractUrlArgument(fn);
            if (!isSafeImageDataUri(arg)) {
                return true;
            }
            continue;
        }
        // Recurse into every function's children so denied functions
        // nested inside safe wrappers (e.g. calc(100% - expression(...)))
        // are still caught.
        if (hasUnsafeFunction(fn.nodes)) return true;
    }
    return false;
}

function hasDangerousProperty(prop: string, value: string): boolean {
    const propLower = prop.toLowerCase();
    if (DENIED_PROPERTY_NAMES.has(propLower)) return true;
    if (propLower === 'filter' && /progid\s*:/i.test(value)) return true;
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

    let output: string;
    if (mode === 'declaration-list') {
        const synthetic = root.first;
        if (!synthetic || synthetic.type !== 'rule') {
            return '';
        }
        output = synthetic.nodes
            .map(n => n.toString())
            .join('')
            .trim();
    } else {
        output = root.toString();
    }

    if (!finalPassIsClean(output)) {
        console.warn(
            'sanitizeCss: defense-in-depth final pass caught a dangerous pattern; dropping entire block'
        );
        return '';
    }
    return output;
}

/**
 * Drop any declaration whose property or value violates the rule set.
 *
 * The checks run in order of increasing cost:
 *  1. Property-name denylist (`behavior`, `-moz-binding`, and `filter` with
 *     a `progid:` value — the legacy IE filter syntax). Runs first and
 *     catches declarations even with empty values.
 *  2. Bare dangerous scheme check (`javascript:`, `vbscript:`, `data:text/html`,
 *     etc.) on the value string with url(...) tokens pre-stripped so safe
 *     image data URIs don't false-positive.
 *  3. Cheap substring early-out: if the value has no `url(`, `expression(`,
 *     `-moz-binding(`, or `attr(` token anywhere, skip the parse entirely.
 *  4. Full postcss-value-parser AST walk via `hasUnsafeFunction`, which
 *     recurses into every function's children (not just gradient/image-set
 *     containers) so attacker payloads like `calc(100% - expression(...))`
 *     are caught. For `url()` tokens the argument is validated against the
 *     image data-URI allowlist.
 *
 * CSS custom properties (`--foo`) are covered because the walker operates
 * on `decl.value`, which postcss populates the same way for custom
 * properties as for standard ones.
 *
 * If postcss-value-parser fails to parse the value, the declaration is
 * dropped as a safe default.
 *
 * Task 13 will add a defense-in-depth regex pass over the serialized
 * output as a final safety net, and strengthen the parse-failure test.
 */
function isDangerousDeclaration(decl: Declaration): boolean {
    const value = decl.value;
    if (!value) {
        return hasDangerousProperty(decl.prop, '');
    }
    if (hasDangerousProperty(decl.prop, value)) return true;
    if (hasDangerousSchemeInValue(value)) return true;
    if (!/url\s*\(|expression\s*\(|-moz-binding\s*\(|attr\s*\(/i.test(value)) {
        return false;
    }

    let parsed;
    try {
        parsed = valueParser(value);
    } catch {
        return true;
    }
    return hasUnsafeFunction(parsed.nodes);
}
