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

const CHANNELS = ['alpha', 'beta'];
// Channel builds exist for the two published editions only; standalone is
// already an independent side-load artifact.
const CHANNEL_ICONS = {
    standard: (c) => `assets/palette_icon_standard_${c}.png`,
    certified: (c) => `assets/palette_icon_secure_${c}.png`
};

// Single source of truth for composing base pbiviz.json + edition overlay +
// optional prerelease channel overlay (GUID prefix, displayName suffix,
// channel icon). Consumed by pbiviz.mjs (package-time config) and
// scripts/select-edition.mjs (generated-file prestep). The internal 4-part
// `version` is deliberately never modified by the channel overlay.
// Consumers assembling a pbiviz config must destructure the three pbiviz
// keys (visual/assets/capabilities) rather than spreading the whole result —
// sanitize/edition are build-policy fields, not pbiviz fields. The returned
// `edition` is the edition *label* ('flagship' | 'secure' | 'standalone'),
// not the editionKey argument ('standard' | 'certified' | 'standalone').
export function resolveEditionConfig(base, editionKey = 'certified', channel) {
    const e = editions[editionKey];
    if (!e) {
        throw new Error(`Unknown edition: ${editionKey}`);
    }
    const visual = { ...base.visual, ...e.visual };
    const assets = { ...base.assets, ...e.assets };
    const capabilities = e.capabilities ?? base.capabilities;
    if (channel) {
        if (!CHANNELS.includes(channel)) {
            throw new Error(`Unknown channel: ${channel}`);
        }
        const icon = CHANNEL_ICONS[editionKey];
        if (!icon) {
            throw new Error(
                `Edition '${editionKey}' does not support channel builds`
            );
        }
        visual.guid = `${channel.toUpperCase()}${visual.guid}`;
        visual.displayName = `${visual.displayName} (${
            channel[0].toUpperCase() + channel.slice(1)
        })`;
        assets.icon = icon(channel);
    }
    return {
        visual,
        assets,
        capabilities,
        sanitize: e.sanitize,
        edition: e.edition
    };
}
