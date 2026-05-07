// Internal dependencies
import { visual } from '../pbiviz.json';

import { RenderFormat } from './types';

// HTML element names the visual permits in sanitized output. Lowercase
// to match DOMPurify's normalization. Anything not in this list (or
// `svgTags`) is dropped entirely by the sanitizer.
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

// SVG element names the visual permits. Drives both the allowed-tags
// list AND the sanitizer's HTML-vs-SVG branch (denylist for SVG,
// allowlist for HTML), so this is the single source of truth.
//
// SMIL animation elements (animate, animatemotion, animatetransform,
// set) are intentionally excluded — they can override sanitized URL
// attributes at runtime, bypassing scheme enforcement. See PR #141.
//
// <use> is intentionally excluded — same-document references can pull
// in attacker-controlled subtrees that bypass the sanitizer.
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
    'feturbulence'
];

export const VisualConstants = {
    visual: visual,
    contentFormatting: {
        format: <RenderFormat>'html',
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
        noDataMessage: 'No data available to display'
    },
    stylesheet: {
        stylesheet: ''
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
        defaultBodyStylingClass: 'uses-default-body-styling'
    },
    allowedSchemes: [],
    allowedSchemesByTag: <{ [index: string]: string[] }>{
        // Power BI only supports http and https protocols for links
        // mailto: and tel: are not supported by Power BI's launchUrl()
        a: ['http', 'https'],
        // For AppSource certification, img and SVG image tags must NOT load
        // external resources. Only data: URIs are permitted (sanitized by
        // getSanitizedDataUri in sanitize-pipeline.ts).
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
        textpath: ['']
    },
    // HTML and SVG tag groups, exposed individually so the sanitizer
    // can branch on namespace (denylist for SVG, strict allowlist for
    // HTML) without maintaining a parallel list. `allowedTags` is the
    // union — what DOMPurify actually receives.
    htmlTags,
    svgTags,
    allowedTags: [...htmlTags, ...svgTags],
    scriptingPatterns: [
        'javascript:',
        'javascript :',
        'vbscript:',
        'vbscript :',
        'livescript:',
        'livescript :',
        'mocha:',
        'data:text/html',
        'data:text/javascript',
        'data:application/javascript',
        'data:application/x-javascript',
        // All control characters (0x00-0x1F) for javascript obfuscation
        'javas\x00cript',
        'javas\x01cript',
        'javas\x02cript',
        'javas\x03cript',
        'javas\x04cript',
        'javas\x05cript',
        'javas\x06cript',
        'javas\x07cript',
        'javas\x08cript',
        'javas\x09cript',
        'javas\x0Acript',
        'javas\x0Bcript',
        'javas\x0Ccript',
        'javas\x0Dcript',
        'javas\x0Ecript',
        'javas\x0Fcript',
        'javas\x10cript',
        'javas\x11cript',
        'javas\x12cript',
        'javas\x13cript',
        'javas\x14cript',
        'javas\x15cript',
        'javas\x16cript',
        'javas\x17cript',
        'javas\x18cript',
        'javas\x19cript',
        'javas\x1Acript',
        'javas\x1Bcript',
        'javas\x1Ccript',
        'javas\x1Dcript',
        'javas\x1Ecript',
        'javas\x1Fcript',
        // CSS-based attacks
        'expression(',
        'expression (',
        '-moz-binding',
        'behavior:',
        'behavior :',
        // URL functions that can be dangerous
        'url(javascript',
        'url( javascript',
        'url(data:text/html',
        'url( data:text/html',
        'url(data:text/javascript',
        'url( data:text/javascript',
        'url(data:application/',
        'url( data:application/',
        'url(vbscript',
        'url( vbscript'
    ],
    // Comprehensive CSS dangerous patterns for style tag content
    cssDangerousPatterns: [
        /@[\s\\\/\*]*i[\s\\\/\*]*m[\s\\\/\*]*p[\s\\\/\*]*o[\s\\\/\*]*r[\s\\\/\*]*t/i,
        /expression\s*\(/i,
        /javascript\s*:/i,
        /vbscript\s*:/i,
        /data\s*:\s*text\/html/i,
        /data\s*:\s*text\/javascript/i,
        /data\s*:\s*application\/javascript/i,
        /-moz-binding\s*:/i,
        /behavior\s*:/i,
        /url\s*\(\s*['"]?\s*javascript/i,
        /url\s*\(\s*['"]?\s*vbscript/i,
        /url\s*\(\s*['"]?\s*data\s*:\s*text\//i
    ]
};
