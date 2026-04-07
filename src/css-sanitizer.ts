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
 * The single rule implemented in Task 9: drop any declaration whose value
 * contains a `url(...)` token whose argument is not an allowlisted image
 * data URI. Tasks 10-13 will replace this with a structured value walker.
 */
function isDangerousDeclaration(decl: Declaration): boolean {
    const value = decl.value;
    if (!value || !value.toLowerCase().includes('url(')) {
        return false;
    }
    const urlMatch = value.match(/url\s*\(\s*['"]?\s*([^'")\s]+)/i);
    if (!urlMatch) {
        return true;
    }
    const target = urlMatch[1].toLowerCase();
    if (!target.startsWith('data:image/')) {
        return true;
    }
    if (target.startsWith('data:image/svg+xml')) {
        return true;
    }
    return false;
}
