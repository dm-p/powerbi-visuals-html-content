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
    dom: {
        viewerIdSelector: 'htmlViewer',
        entryClassSelector: 'htmlViewerEntry',
        statusIdSelector: 'statusMessage',
        contentIdSelector: 'htmlContent',
        landingIdSelector: 'landingPage',
        landingPageClassPrefix: 'html-display',
        stylesheetIdSelector: 'visualUserStylesheet',
        rawOutputIdSelector: 'rawHtmlOutput'
    }
};
