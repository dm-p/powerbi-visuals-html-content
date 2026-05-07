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
import type { Node as ValueNode, FunctionNode } from 'postcss-value-parser';

// postcss-value-parser is a CommonJS module whose types declare the parser
// function as the module export. Importing it as `import valueParser from ...`
// requires esModuleInterop or allowSyntheticDefaultImports — the repo
// tsconfig sets neither, and vitest's transform happens to tolerate the
// default-import form but pbiviz package's strict ts-loader pass does not.
// Using require() + a type-only import matches the existing pattern for
// `pretty` in src/domain-utils.ts and keeps runtime semantics identical.
const valueParser: (value: string) => {
    nodes: ValueNode[];
} = require('postcss-value-parser');

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
    return !DEFENSE_IN_DEPTH_PATTERNS.some((p) => p.test(serialized));
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
    // Intentionally broad: matches `data:image` anywhere in the value,
    // including inside string literals (e.g. content: "data:image/png example").
    // The url()-token pre-strip above prevents false positives for safe
    // data URIs *inside* url() tokens, but a bare string literal containing
    // the text "data:image" will still be flagged. This is an acceptable
    // false positive — security-first over edge-case string preservation.
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
    return DANGEROUS_SCHEME_PATTERNS.some((p) => p.test(stripped));
}

function hasDangerousSelector(selector: string): boolean {
    if (/javascript\s*:/i.test(selector)) return true;
    // Reject control characters in 0x00-0x1F EXCEPT the whitespace
    // controls that the CSS spec treats as valid: TAB (0x09), LF (0x0A),
    // FF (0x0C), CR (0x0D). Multi-line comma-separated selectors
    //
    //   .a,
    //   .b { ... }
    //
    // are normal real-world formatting and must not be dropped by this
    // check (issue #143 report — multi-line layout
    // selectors silently disappeared because of the over-broad range).
    for (let i = 0; i < selector.length; i++) {
        const code = selector.charCodeAt(i);
        if (
            code <= 0x1f &&
            code !== 0x09 && // TAB
            code !== 0x0a && // LF
            code !== 0x0c && // FF
            code !== 0x0d // CR
        ) {
            return true;
        }
    }
    return false;
}

const SAFE_IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml'
]);

const DENIED_FUNCTIONS = new Set<string>([
    'expression',
    '-moz-binding',
    'attr'
]);

const DENIED_PROPERTY_NAMES = new Set<string>(['behavior', '-moz-binding']);

function extractUrlArgument(node: FunctionNode): string {
    const child = node.nodes.find(
        (n) => n.type === 'word' || n.type === 'string'
    );
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
    if (!SAFE_IMAGE_MIME_TYPES.has(mime)) return false;
    // Real binary image data is always base64-encoded. A data:image/*
    // URI without ;base64, is always smuggling plain-text content (HTML,
    // script) behind an image MIME declaration — except for SVG, which
    // is text by spec and is legitimately emitted as
    // `data:image/svg+xml;utf8,<svg ...>` (or the bare comma form) by
    // tools and DAX measures. This mirrors the same MIME-conditional
    // base64 check in getSanitizedDataUri (sanitize-pipeline.ts).
    if (mime !== 'image/svg+xml' && !/;base64,/i.test(rawUrl)) return false;
    return true;
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

    root.walkAtRules((atRule) => {
        if (!ALLOWED_AT_RULES.has(atRule.name.toLowerCase())) {
            atRule.remove();
        }
    });

    if (mode === 'stylesheet') {
        root.walkRules((rule) => {
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
        // Serialize the whole synthetic rule so postcss's stringify inserts
        // separators (';') between declarations, then strip the wrapper
        // braces. Joining per-node toString() by hand would drop the
        // separators because Declaration.toString() does NOT include the
        // trailing semicolon — that's the container's job, not the node's.
        const full = synthetic.toString();
        const match = full.match(/^[^{]*\{([\s\S]*)\}\s*$/);
        output = match ? match[1].trim() : '';
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
