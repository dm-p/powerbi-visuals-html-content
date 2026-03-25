// External dependencies
import * as sanitizeHtml from 'sanitize-html';
// Internal dependencies
import { visual } from '../pbiviz.json';

import { RenderFormat } from './types';

export const VisualConstants = {
    visual: visual,
    contentFormatting: {
        format: <RenderFormat>'html',
        showRawHtml: false,
        font: {
            family:
                "'Segoe UI', wf_segoe-ui_normal, helvetica, arial, sans-serif",
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
        unselectedClassSelector: 'unselected'
    },
    allowedSchemes: [],
    allowedSchemesByTag: <{ [index: string]: string[] }>{
        // Power BI only supports http and https protocols for links
        // mailto: and tel: are not supported by Power BI's launchUrl()
        a: ['http', 'https'],
        // For AppSource certification, img tags must NOT load external resources
        // Only data: URIs are permitted (sanitized by getSanitizedDataUri function)
        img: ['data']
    },
    allowedTags: [
        ...sanitizeHtml.defaults.allowedTags,
        'img',
        'svg',
        'animate',
        'animatemotion',
        'animatetransform',
        'circle',
        'clippath',
        'defs',
        'desc',
        'del',
        'details',
        'ellipse',
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
        'filter',
        'g',
        'image',
        'ins',
        'line',
        'lineargradient',
        'marker',
        'mask',
        'meter',
        'metadata',
        'output',
        'path',
        'pattern',
        'polygon',
        'polyline',
        'progress',
        'radialgradient',
        'rect',
        'search',
        'set',
        'stop',
        'style',
        'summary',
        'symbol',
        'text',
        'textpath',
        'title',
        'tspan',
        'view'
    ],
    scriptingPatterns: [
        // eslint-disable-next-line no-script-url
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
        // eslint-disable-next-line no-useless-escape
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
