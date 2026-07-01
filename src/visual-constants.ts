// Internal dependencies
import { RESOLVED_VISUAL, EDITION } from './visual-config.generated';

import { RenderFormat, RenderMode } from './types';
import {
    SCHEME_REGEXES,
    SCHEME_SUBSTRINGS
} from './sanitize/dangerous-patterns';

/**
 * HTML element names the visual permits in sanitized output. Lowercase
 * to match DOMPurify's normalization. Anything not in this list (or
 * `svgTags`) is dropped entirely by the sanitizer.
 */
const htmlTags = [
    // HTML — block + sectioning
    'address',
    'article',
    'aside',
    'blockquote',
    'div',
    'dd',
    'details',
    'dl',
    'dt',
    'figcaption',
    'figure',
    'footer',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hgroup',
    'hr',
    'main',
    'menu',
    'nav',
    'ol',
    'output',
    'p',
    'pre',
    'search',
    'section',
    'summary',
    'ul',
    'li',
    // HTML — inline + phrasing
    'a',
    'abbr',
    'b',
    'bdi',
    'bdo',
    'br',
    'cite',
    'code',
    'data',
    'del',
    'dfn',
    'em',
    'i',
    'ins',
    'kbd',
    'mark',
    'meter',
    'progress',
    'q',
    'rb',
    'rp',
    'rt',
    'rtc',
    'ruby',
    's',
    'samp',
    'small',
    'span',
    'strong',
    'sub',
    'sup',
    'time',
    'u',
    'var',
    'wbr',
    // HTML — table
    'caption',
    'col',
    'colgroup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    // Project-specific additions
    'img',
    'style'
];

/**
 * SVG element names the visual permits. Drives both the allowed-tags
 * list AND the sanitizer's HTML-vs-SVG branch (denylist for SVG,
 * allowlist for HTML), so this is the single source of truth.
 *
 * SMIL animation elements (animate, animatemotion, animatetransform,
 * set) are permitted but locked down by two enforcement layers in
 * sanitize/backend.certified.ts:
 *   1. Per-tag URL scheme allowlist set to fragment-only ([''] in
 *      VisualConstants.allowedSchemesByTag), so the element's own
 *      href / xlink:href can only point at same-document fragments.
 *   2. SMIL_ATTRIBUTE_NAME_DENYLIST rejects animation that targets
 *      URL-bearing or sanitizer-bypass attributes (href, xlink:href,
 *      src, mask, clip-path, filter, marker-*, cursor, style, and
 *      the meta attributeName itself). The well-known SMIL bypass —
 *      `<animate attributeName="href" to="javascript:..."/>` to
 *      rewrite a sanitized URL post-load — is closed by this gate.
 *      Animation targeting safe presentation/geometry properties
 *      (opacity, transform, fill, stroke, cx, cy, d, etc.) is
 *      unrestricted.
 *
 * <use> is intentionally excluded — same-document references can pull
 * in attacker-controlled subtrees that bypass the sanitizer.
 */
const svgTags = [
    // SVG — root, structural, shape
    'svg',
    'circle',
    'clippath',
    'defs',
    'desc',
    'ellipse',
    'g',
    'image',
    'line',
    'marker',
    'mask',
    'metadata',
    'path',
    'pattern',
    'polygon',
    'polyline',
    'rect',
    'stop',
    'symbol',
    'text',
    'textpath',
    'title',
    'tspan',
    'view',
    // SVG — gradients
    'lineargradient',
    'radialgradient',
    // SVG — filter primitives
    'filter',
    'feblend',
    'fecolormatrix',
    'fecomponenttransfer',
    'fecomposite',
    'feconvolvematrix',
    'fediffuselighting',
    'fedisplacementmap',
    'fedistantlight',
    'fedropshadow',
    'feflood',
    'fefunca',
    'fefuncb',
    'fefuncg',
    'fefuncr',
    'fegaussianblur',
    'feimage',
    'femerge',
    'femergenode',
    'femorphology',
    'feoffset',
    'fepointlight',
    'fespecularlighting',
    'fespotlight',
    'fetile',
    'feturbulence',
    // SVG — SMIL animation. Locked down by the SMIL_ATTRIBUTE_NAME_DENYLIST
    // and fragment-only allowedSchemesByTag entries below; see the comment
    // block above this list for the full enforcement model.
    'animate',
    'animatemotion',
    'animatetransform',
    'set'
];

/**
 * Central bag of compile-time constants for the visual: identity/edition,
 * landing-page URLs, formatting defaults (mirroring the settings), DOM
 * id/class selectors, diagnostics caps, and the sanitizer allowlists /
 * denylists. Single source of truth consumed across the codebase.
 */
export const VisualConstants = {
    visual: RESOLVED_VISUAL,
    edition: EDITION,
    landingUrls: {
        docs: RESOLVED_VISUAL.supportUrl,
        quickStart: `${RESOLVED_VISUAL.supportUrl}/docs/simple-example`,
        changelog: `${RESOLVED_VISUAL.supportUrl}/docs/change-log`,
        github: RESOLVED_VISUAL.gitHubUrl,
        sponsor: 'https://github.com/sponsors/dm-p',
        coffee: 'https://buymeacoffee.com/dmp'
    },
    contentFormatting: {
        format: <RenderFormat>'html',
        renderMode: <RenderMode>'rebuild',
        showRawHtml: false,
        font: {
            family: "'Segoe UI', wf_segoe-ui_normal, helvetica, arial, sans-serif",
            colour: '#000000',
            size: 11
        },
        align: 'left',
        separation: 'none',
        hyperlinks: false,
        userSelect: false,
        // Default OFF: inline color/font/alignment are honored as authored.
        // When ON, the cascade override in style/visual.less forces every
        // inline-styled descendant to inherit the four pane-aligned
        // properties — paste-cleanup mode for the original issue #144
        // reporters. Custom-stylesheet mode disables this gate entirely
        // regardless of the toggle's value.
        overrideInlineStyling: false,
        noDataMessage: 'No data available to display',
        // Off by default. When on (and the host supports modal dialogs) the
        // diagnostics icon appears; it also arms the passive sanitizer sink
        // and console capture. Does not affect rendered output.
        enableDiagnostics: false
    },
    stylesheet: {
        stylesheet: ''
    },
    templates: {
        body: '{{content}}',
        row: '<div><div>{{row}}</div></div>'
    },
    crossFilter: {
        enabled: false,
        useTransparency: true,
        transparencyPercent: 70
    },
    dom: {
        viewerIdSelector: 'htmlViewer',
        entryClassSelector: 'htmlViewerEntry',
        statusIdSelector: 'statusMessage',
        contentIdSelector: 'htmlContent',
        landingIdSelector: 'landingPage',
        landingPageClassPrefix: 'html-display',
        stylesheetIdSelector: 'visualUserStylesheet',
        rawOutputIdSelector: 'rawHtmlOutput',
        hoverClassSelector: 'hover',
        manualTooltipSelector: 'tooltipEnabled',
        manualTooltipDataPrefix: 'tooltip',
        manualTooltipDataTitle: 'Title', // Will be camel-cased by HTML data API
        manualTooltipDataValue: 'Value', // Will be camel-cased by HTML data API
        unselectedClassSelector: 'unselected',
        // Class added to the body container when default body styling is in
        // effect (i.e. the user has NOT supplied a custom stylesheet). The
        // matching rule in style/visual.less forces inline-styled descendants
        // inside #htmlContent to inherit the body styling instead of their
        // own embedded color/font-family/font-size/text-align values. Closes
        // issue #144 (office-paste residue overriding Default body styling).
        defaultBodyStylingClass: 'uses-default-body-styling',
        // Internal sentinel used by resolveTemplateContainer to locate the
        // body-template content slot during parse. The user's `{{content}}`
        // token is substituted for an HTML comment carrying this value before
        // the body template is parsed; a comment is valid in every content
        // model and is not foster-parented (unlike a bare token or a
        // context-invalid element), so it reliably marks the slot's position.
        // A persistent invisible anchor comment with the same value is left at
        // the slot after sanitization for row insertion. NOT the user-facing
        // token — purely an implementation detail of slot resolution.
        contentSlotMarker: 'HC:CONTENT',
        // Declarative interactivity suppression. An author adds
        // data-hc-suppress="filter context-menu tooltip" (or "all") to a node to
        // make it + its descendants inert to the visual's cross-filter / context
        // menu / tooltip handling, deferring to their own / native behaviour.
        // Works in every edition because the visual reads the markup itself.
        suppressAttr: 'data-hc-suppress',
        suppressAllToken: 'all',
        // Theme CSS variables. The constructor writes a dedicated <style>
        // (themeVarsIdSelector) holding the :root { --pbi-theme-* } block, and
        // reflects host high-contrast state as themeHighContrastClass on the
        // #htmlContent container (so it shows in the Show-raw-HTML view) — authors
        // branch in pure CSS (`.pbi-theme-hc …`).
        // `hc-` is NOT used: it is this project's html-content token namespace.
        themeVarsIdSelector: 'pbiThemeVars',
        themeHighContrastClass: 'pbi-theme-hc'
    },
    diagnostics: {
        dialogId: 'DiagnosticsDialog',
        iconIdSelector: 'htmlDiagnosticsToggle',
        // Snapshot caps (Decision 9) — bound the cross-iframe initialState
        // for the multi-MB content authors push through this visual.
        rawHtmlCapBytes: 512 * 1024,
        sanitizerEntryCap: 1000,
        consoleBufferCap: 200,
        consoleLineCap: 2000,
        // Above this raw length, skip span-colorization and render plain
        // (escaped) text to avoid a token-span node explosion.
        highlightSizeLimit: 200 * 1024,
        // Host-event log (Events tab): ring-buffer size, and per-event context
        // bounds (first N tooltip items, each value capped to eventContextCap).
        eventBufferCap: 200,
        eventContextItems: 3,
        eventContextCap: 80,
        // Dialog title is localized (Diagnostics_DialogTitle), resolved in
        // visual.ts; only the size lives here.
        dialog: {
            size: { width: 900, height: 600 }
        },
        // Documentation pages linked from the Sanitizer tab. The dialog passes
        // only a doc KEY back; the visual maps it to one of these URLs and
        // launches via host.launchUrl — so only these known URLs can ever open.
        docs: {
            sanitization: 'https://html-content.com/docs/sanitization',
            acceptedTags: 'https://html-content.com/docs/accepted-tags'
        }
    },
    allowedSchemes: [],
    allowedSchemesByTag: <{ [index: string]: string[] }>{
        // Power BI only supports http and https protocols for links
        // mailto: and tel: are not supported by Power BI's launchUrl()
        a: ['http', 'https'],
        // For AppSource certification, img and SVG image tags must NOT load
        // external resources. Only data: URIs are permitted (sanitized by
        // getSanitizedDataUri in sanitize/data-uri.ts).
        img: ['data'],
        image: ['data'],
        // SVG filter primitive that accepts an external image source.
        // Same restriction as <image>: data: URIs only.
        feimage: ['data'],
        // SVG href references on shape-paint / paint-server / filter
        // elements should only resolve to same-document fragments
        // (#gradient1, #pattern1, #shadow). External URLs would fetch.
        // Empty-scheme matches #fragment values.
        pattern: [''],
        lineargradient: [''],
        radialgradient: [''],
        filter: [''],
        // textpath href references a <path> element for text layout.
        // Only same-document fragment refs (#id) are valid; external URLs
        // would trigger a fetch. Empty-scheme matches #fragment values.
        textpath: [''],
        // marker and symbol can use href / xlink:href to reference
        // another marker / symbol in the same document (SVG2 inheritance
        // pattern). Same fragment-only policy as gradients / patterns —
        // external URLs are dropped.
        marker: [''],
        symbol: [''],
        // SMIL animation elements may carry an href / xlink:href that
        // points at the element to animate. Same-document fragment refs
        // only — external URLs would let an animation pull behavior from
        // an attacker-controlled SVG.
        animate: [''],
        animatemotion: [''],
        animatetransform: [''],
        set: ['']
    },
    // HTML and SVG tag groups, exposed individually so the sanitizer
    // can branch on namespace (denylist for SVG, strict allowlist for
    // HTML) without maintaining a parallel list. `allowedTags` is the
    // union — what DOMPurify actually receives.
    htmlTags,
    svgTags,
    allowedTags: [...htmlTags, ...svgTags],
    // Derived verbatim from the canonical SCHEME_SUBSTRINGS denylist so the
    // HTML/URL substring scan shares one source of truth with the CSS scheme
    // regexes. Do NOT re-literal these here — add new entries to
    // sanitize/dangerous-patterns.ts.
    scriptingPatterns: [...SCHEME_SUBSTRINGS],
    /**
     * Dangerous-CSS regex denylist. The dangerous-scheme members (indices
     * 2-6) are sourced from the canonical `SCHEME_REGEXES` rather than being
     * re-literaled here, so the scheme knowledge lives in exactly one place
     * (`sanitize/dangerous-patterns.ts`). The remaining members are
     * CSS-specific (obfuscated `@import`, `expression(`, `-moz-binding:`,
     * `behavior:`, and the url(...)-wrapped scheme variants) and have no
     * equivalent in the shared scheme list, so they stay inline.
     *
     * Member order is preserved deliberately: several security tests pin
     * specific indices ([0] = obfuscated @import, [1] = expression,
     * [2] = javascript) as documentation of the rule set.
     */
    cssDangerousPatterns: [
        /@[\s\\\/\*]*i[\s\\\/\*]*m[\s\\\/\*]*p[\s\\\/\*]*o[\s\\\/\*]*r[\s\\\/\*]*t/i,
        /expression\s*\(/i,
        SCHEME_REGEXES[0], // /javascript\s*:/i
        SCHEME_REGEXES[1], // /vbscript\s*:/i
        SCHEME_REGEXES[4], // /data\s*:\s*text\/html/i
        SCHEME_REGEXES[5], // /data\s*:\s*text\/javascript/i
        SCHEME_REGEXES[6], // /data\s*:\s*application\/javascript/i
        /-moz-binding\s*:/i,
        /behavior\s*:/i,
        /url\s*\(\s*['"]?\s*javascript/i,
        /url\s*\(\s*['"]?\s*vbscript/i,
        /url\s*\(\s*['"]?\s*data\s*:\s*text\//i
    ]
};
