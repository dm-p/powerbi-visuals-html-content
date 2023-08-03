// Power BI API references
import powerbiVisualsApi from 'powerbi-visuals-api';
import powerbi = powerbiVisualsApi;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;

// External dependencies
import { Selection } from 'd3-selection';

// Internal dependencies
import { VisualConstants } from './visual-constants';
import { resolveScrollableContent } from './domain-utils';

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
        // Top-level elements
        const container = this.element
            .append('div')
            .classed(
                `${VisualConstants.dom.landingPageClassPrefix}-landing-page`,
                true
            )
            .classed('w3-card-4', true);

        const heading = container
            .append('div')
            .classed('w3-container', true)
            .classed('w3-theme', true);

        const version = container
            .append('div')
            .classed('w3-container', true)
            .classed('w3-theme-l3', true)
            .classed('w3-small', true);

        const helpBox = container
            .append('div')
            .classed('w3-container', true)
            .classed('w3-theme-l5', true)
            .classed(
                `${VisualConstants.dom.landingPageClassPrefix}-watermark`,
                true
            )
            .classed(
                `${VisualConstants.dom.landingPageClassPrefix}-help`,
                true
            );

        // Add title
        heading.append('h5').text(VisualConstants.visual.displayName);

        // Add version number
        version.text(VisualConstants.visual.version);

        // Help box content

        // Button / remote link
        helpBox
            .append('button')
            .classed('w3-button', true)
            .classed('w3-theme-action', true)
            .classed('w3-circle', true)
            .style('position', 'fixed')
            .style('top', '24px')
            .style('right', '12px')
            .on('click', () =>
                host.launchUrl(VisualConstants.visual.supportUrl)
            )
            .text('?');

        // Overview
        helpBox
            .append('p')
            .classed('w3-small', true)
            .text(
                this.localisationManager.getDisplayName(
                    'Landing_Page_Overview_1'
                )
            );
        helpBox
            .append('p')
            .classed('w3-small', true)
            .text(
                this.localisationManager.getDisplayName(
                    'Landing_Page_Overview_2'
                )
            );
        helpBox
            .append('p')
            .classed('w3-small', true)
            .text(
                this.localisationManager.getDisplayName(
                    'Landing_Page_Overview_3'
                )
            );
        helpBox
            .append('p')
            .classed('w3-small', true)
            .text(
                this.localisationManager.getDisplayName(
                    'Landing_Page_Overview_4'
                )
            );

        resolveScrollableContent(container.node());
    }
}
