// External dependencies
import * as sanitizeHtml from 'sanitize-html';
// Internal dependencies
import { visual } from '../pbiviz.json';

export const VisualConstants = {
    visual: visual,
    contentFormatting: {
        showRawHtml: false,
        font: {
            family:
                '"Segoe UI", wf_segoe-ui_normal, helvetica, arial, sans-serif',
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
        a: ['http', 'https'],
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
        'ellipse',
        'feblend',
        'fecolormatrix',
        'fecomponenttransfer',
        'fecomposite',
        'feconvolvematrix',
        'fediffuselighting',
        'fedisplacementMap',
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
        'femergemode',
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
        'line',
        'lineargradient',
        'marker',
        'mask',
        'metadata',
        'path',
        'pattern',
        'polygon',
        'polyline',
        'radialgradient',
        'rect',
        'set',
        'stop',
        'style',
        'symbol',
        'text',
        'textpath',
        'title',
        'tspan',
        'view'
    ],
    scriptingPatterns: [
        'javascript',
        'javas\x00script',
        'javas\x07cript',
        'javas\x0Dcript',
        'javas\x0Acript',
        'javas\x08cript'
    ]
};
