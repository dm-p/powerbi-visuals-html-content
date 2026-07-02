// Power BI API references
import powerbiVisualsApi from 'powerbi-visuals-api';
import powerbi = powerbiVisualsApi;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;

// External dependencies
import { Selection } from 'd3-selection';

// Internal dependencies
import { VisualConstants } from '../visual-constants';
import { buildSplash, LandingLabels } from './splash';
import { MARK_URL } from './mark.generated';

/**
 * Manages the handling and placement of the visual landing page if no data is present.
 */
export default class LandingPageHandler {
    // Specifies that the landing page is currently on.
    landingPageEnabled: boolean = false;
    // Specifies that the landing page has been removed since being displayed.
    landingPageRemoved: boolean = false;
    // Element to bind the landing page to.
    private element: Selection<any, any, any, any>;
    // Handle localisation of visual text.
    private localisationManager: ILocalizationManager;

    /**
     * @param element               - main visual element
     * @param localisationManager   - Power BI localisation manager instance
     */
    constructor(
        element: Selection<any, any, any, any>,
        localisationManager: ILocalizationManager
    ) {
        this.element = element;
        this.localisationManager = localisationManager;
    }

    /**
     * Handles the display or removal of the landing page elements
     * @param options   - visual update options
     * @param host      - Power BI visual host services
     */
    handleLandingPage(viewModelIsValid: boolean, host: IVisualHost) {
        // Conditions for showing landing page
        if (!viewModelIsValid) {
            if (!this.landingPageEnabled) {
                this.landingPageEnabled = true;
                this.render(host);
            }
        } else {
            this.clear();
        }
    }

    /**
     * Clears down the landing page of elements
     */
    clear() {
        this.element.selectAll('*').remove();
        if (this.landingPageEnabled && !this.landingPageRemoved) {
            this.landingPageRemoved = true;
        }
        this.landingPageEnabled = false;
    }

    /**
     * Renders the landing page content
     *
     * @param host - Power BI visual host services
     */
    render(host: IVisualHost) {
        const get = (key: string) =>
            this.localisationManager.getDisplayName(key);
        const labels: LandingLabels = {
            headline: get('Landing_Headline'),
            body: get('Landing_Body'),
            quickStart: get('Landing_QuickStart'),
            whatsNew: get('Landing_WhatsNew'),
            sandboxNote: get('Landing_SandboxNote'),
            sandboxNoteLink: get('Landing_SandboxNoteLink'),
            openDocs: get('Landing_OpenDocs')
        };

        const el = this.element.node();
        if (!el) return;
        const doc = el.ownerDocument as Document;
        const splash = buildSplash(doc, {
            edition: VisualConstants.edition,
            version: VisualConstants.visual.version,
            markUrl: MARK_URL,
            labels,
            urls: VisualConstants.landingUrls,
            onLaunch: (url: string) => host.launchUrl(url)
        });
        // Keep the existing container class prefix so external hooks still match.
        splash.classList.add(
            `${VisualConstants.dom.landingPageClassPrefix}-landing-page`
        );
        el.appendChild(splash);
        // No OverlayScrollbars here: the splash is a static, self-sizing layout
        // (.hc-landing is min-height:100vh and fills the visual). OS would wrap
        // the content in an auto-height layer that breaks the height fill, and
        // the splash doesn't need custom scrollbars — #htmlViewer's own
        // overflow:auto covers the rare case where content exceeds the viewport.
    }
}
