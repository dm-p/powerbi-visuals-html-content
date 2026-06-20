/**
 * Passthrough sanitizer backend for the base (standalone/standard) editions.
 * Identity/no-ops — zero heavy imports — so dompurify / postcss / css-sanitizer
 * / svg-payload-scan never enter this edition's module graph. Behavior matches
 * today's `config.sanitize === false` path exactly: author HTML/CSS render as-is.
 */
import { SanitizeOptions } from './options';

export const sanitizeHtmlString = (
    html: string,
    _options?: SanitizeOptions
): string => html;

export const preprocessHtmlString = (html: string): string => html;

export const sanitizeFragmentInPlace = (
    _fragment: DocumentFragment | Element,
    _options?: SanitizeOptions
): void => {
    /* base editions trust author input; nothing to sanitize */
};

export const sanitizeCssString = (css: string): string => css;

export const enabled = false;
