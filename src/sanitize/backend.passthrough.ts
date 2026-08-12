/**
 * Passthrough sanitizer backend for the base (standalone/standard) editions.
 * Identity/no-ops — zero heavy imports — so dompurify / postcss / css-sanitizer
 * / svg-payload-scan never enter this edition's module graph. Behavior matches
 * today's `config.sanitize === false` path exactly: author HTML/CSS render as-is.
 */
import { SanitizeOptions } from './options';

/** Passthrough counterpart to the certified `sanitizeHtmlString`: returns the HTML unchanged. */
export const sanitizeHtmlString = (
    html: string,
    _options?: SanitizeOptions
): string => html;

/** Passthrough counterpart to the certified `preprocessHtmlString`: no <style> pre-processing. */
export const preprocessHtmlString = (html: string): string => html;

/** Passthrough counterpart to the certified `sanitizeFragmentInPlace`: leaves the fragment untouched. */
export const sanitizeFragmentInPlace = (
    _fragment: DocumentFragment | Element,
    _options?: SanitizeOptions
): void => {
    /* base editions trust author input; nothing to sanitize */
};

/** Passthrough counterpart to the certified `sanitizeCssString`: returns the CSS unchanged. */
export const sanitizeCssString = (css: string): string => css;

/** This edition does not run the sanitizer. */
export const enabled = false;
