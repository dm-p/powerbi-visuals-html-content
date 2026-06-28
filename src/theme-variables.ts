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

// `colors` (the numbered data palette) is present on the host palette at
// runtime but NOT declared on ISandboxExtendedColorPalette (only getColor is).
// Reached via this narrow shape, mirroring Deneb's PowerBIColorPaletteExtension.
interface PaletteColors {
    colors?: { value?: string }[];
}

// Curated named contract: variable suffix → palette member name. Order is the
// public contract order. Sentiment members are optional on the interface and
// simply absent on themes that don't define them (the guard below skips them).
// Divergent endpoints (min/center/max) are deliberately excluded — see spec.
const NAMED: { suffix: string; member: string }[] = [
    { suffix: 'fg', member: 'foreground' },
    { suffix: 'fg-neutral-secondary', member: 'foregroundNeutralSecondary' },
    { suffix: 'fg-neutral-tertiary', member: 'foregroundNeutralTertiary' },
    { suffix: 'bg', member: 'background' },
    { suffix: 'bg-light', member: 'backgroundLight' },
    { suffix: 'bg-neutral', member: 'backgroundNeutral' },
    { suffix: 'fg-selected', member: 'foregroundSelected' },
    { suffix: 'hyperlink', member: 'hyperlink' },
    { suffix: 'positive', member: 'positive' },
    { suffix: 'negative', member: 'negative' },
    { suffix: 'neutral', member: 'neutral' }
];

// Trust-boundary guard: only hex (#rgb/#rgba/#rrggbb/#rrggbbaa) or rgb()/rgba()
// values are written into our <style>. Anything else (named colors the host
// never emits, or an injection attempt like "red; }…") is dropped. Consistent
// with the visual's CSS-sanitizer posture; cheap defense-in-depth.
const COLOR_VALUE =
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^rgba?\([0-9.,\s%]+\)$/i;

export function isValidColorValue(value: string | undefined): boolean {
    return typeof value === 'string' && COLOR_VALUE.test(value.trim());
}

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

    // Curated named colors — emit only when present and valid.
    const bag = palette as unknown as Record<string, { value?: string }>;
    for (const { suffix, member } of NAMED) {
        const info = bag[member];
        if (info && isValidColorValue(info.value)) {
            decls.push(`--pbi-theme-${suffix}: ${info.value};`);
        }
    }

    return decls.length ? `:root { ${decls.join(' ')} }` : '';
}
