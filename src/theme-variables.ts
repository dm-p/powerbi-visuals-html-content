/**
 * Build the `:root { --pbi-theme-* }` CSS block exposing the host theme's
 * colors as custom properties. Pure (no DOM) so it is unit-tested directly;
 * the constructor writes the result into a dedicated <style> element.
 *
 * Values are honest pass-through — never translated for high contrast. The
 * author opts into HC handling via the `.pbi-theme-hc` class (set elsewhere).
 */
import powerbi from 'powerbi-visuals-api';
import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;

/**
 * `colors` (the numbered data palette) is present on the host palette at
 * runtime but NOT declared on ISandboxExtendedColorPalette (only getColor is).
 * Reached via this narrow shape, mirroring Deneb's
 * PowerBIColorPaletteExtension.
 */
interface PaletteColors {
    colors?: { value?: string }[];
}

/**
 * Curated named contract: CSS variable suffix → the host palette member(s) to
 * read (first present & valid wins). Order is the public contract order. A
 * member that a theme doesn't define is simply absent and skipped.
 *
 * Variable names mirror the JSON theme schema keys, which is what theme authors
 * see (e.g. `good`/`bad`/`center`), even where the runtime palette member we
 * read is spelled differently — sentiment is `positive`/`negative` on the
 * runtime object but `good`/`bad` in the theme JSON. `max` lists the upstream
 * `maximium` typo first, then the correct `maximum` (the theme JSON spelling).
 */
const NAMED: { suffix: string; members: string[] }[] = [
    { suffix: 'fg', members: ['foreground'] },
    { suffix: 'fg-neutral-secondary', members: ['foregroundNeutralSecondary'] },
    { suffix: 'fg-neutral-tertiary', members: ['foregroundNeutralTertiary'] },
    { suffix: 'bg', members: ['background'] },
    { suffix: 'bg-light', members: ['backgroundLight'] },
    { suffix: 'bg-neutral', members: ['backgroundNeutral'] },
    { suffix: 'fg-selected', members: ['foregroundSelected'] },
    { suffix: 'hyperlink', members: ['hyperlink'] },
    // Sentiment — JSON theme keys good/bad/neutral; runtime members
    // positive/negative/neutral. Read the runtime member, name after the JSON.
    { suffix: 'good', members: ['positive'] },
    { suffix: 'bad', members: ['negative'] },
    { suffix: 'neutral', members: ['neutral'] },
    // Divergent endpoints.
    { suffix: 'min', members: ['minimum'] },
    { suffix: 'center', members: ['center'] },
    { suffix: 'max', members: ['maximium', 'maximum'] }
];

/**
 * Trust-boundary guard: only hex (#rgb/#rgba/#rrggbb/#rrggbbaa) or
 * rgb()/rgba() values are written into our <style>. Anything else (named
 * colors the host never emits, or an injection attempt like "red; }…") is
 * dropped. Consistent with the visual's CSS-sanitizer posture; cheap
 * defense-in-depth.
 */
const COLOR_VALUE =
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^rgba?\([0-9.,\s%]+\)$/i;

/** True when `value` is a hex or rgb()/rgba() color safe to emit (see COLOR_VALUE). */
export function isValidColorValue(value: string | undefined): boolean {
    return typeof value === 'string' && COLOR_VALUE.test(value.trim());
}

/**
 * Build the `:root { --pbi-theme-* }` declaration block from the host palette:
 * the numbered data colors (1-indexed) plus the curated NAMED members, keeping
 * only values that pass isValidColorValue. Returns '' when nothing resolves.
 */
export function buildThemeVariablesCss(
    palette: ISandboxExtendedColorPalette
): string {
    const decls: string[] = [];

    // Numbered data colors — 1-indexed to match the PBI UI's "Color 1…N".
    const numbered = (palette as unknown as PaletteColors).colors;
    if (Array.isArray(numbered)) {
        numbered.forEach((c, i) => {
            if (isValidColorValue(c?.value)) {
                decls.push(`--pbi-theme-color-${i + 1}: ${c.value};`);
            }
        });
    }

    // Curated named colors — first present-and-valid member wins; emit only if
    // one resolves (so themes that omit a member, or a build without the typo'd
    // key, just skip it).
    const bag = palette as unknown as Record<string, { value?: string }>;
    for (const { suffix, members } of NAMED) {
        const info = members
            .map((m) => bag[m])
            .find((v) => v && isValidColorValue(v.value));
        if (info) {
            decls.push(`--pbi-theme-${suffix}: ${info.value};`);
        }
    }

    return decls.length ? `:root { ${decls.join(' ')} }` : '';
}
