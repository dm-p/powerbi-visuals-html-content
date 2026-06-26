// Single source of truth for per-edition build configuration.
// `certified` is the default (the committed pbiviz.json base): sanitized, no
// WebAccess privilege, audited by Microsoft. The base editions disable the
// sanitizer (handled by the code seam) and point at the committed WebAccess
// capabilities file. Privileges are NOT declared here — they live in the
// committed capabilities files (capabilities.json / capabilities.webaccess.json).
export const editions = {
    certified: {
        visual: {},
        assets: {},
        capabilities: 'capabilities.json',
        sanitize: true,
        edition: 'secure'
    },
    standard: {
        visual: {
            displayName: 'HTML Content',
            guid: 'htmlContent443BE3AD55E043BF878BED274D3A6855',
            description:
                'Visualize column or measure values as HTML in your Power BI reports.'
        },
        assets: { icon: 'assets/palette_icon_standard.png' },
        capabilities: 'capabilities.webaccess.json',
        sanitize: false,
        edition: 'flagship'
    },
    standalone: {
        visual: {
            displayName: 'HTML Content - STANDALONE VERSION',
            guid: 'STANDALONEhtmlContent443BE3AD55E043BF878BED274D3A6855',
            description:
                'Visualize column or measure values as HTML in your Power BI reports.'
        },
        assets: { icon: 'assets/palette_icon_standalone.png' },
        capabilities: 'capabilities.webaccess.json',
        sanitize: false,
        edition: 'standalone'
    }
};
