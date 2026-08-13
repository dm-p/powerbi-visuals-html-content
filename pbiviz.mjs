// Honored by powerbi-visuals-tools (>=6.0.0): a `.mjs` config is dynamically
// imported in preference to the `.json`. This computes the per-edition (and
// per-channel, for alpha/beta prerelease builds) pbiviz config via
// resolveEditionConfig from `config/editions.mjs`, keyed by the active
// edition/channel written by scripts/select-edition.mjs. Defaults to
// `certified` when no edition is selected.
import { readFileSync } from 'node:fs';
import { resolveEditionConfig } from './config/editions.mjs';

const base = JSON.parse(
    readFileSync(new URL('./pbiviz.json', import.meta.url), 'utf8')
);

let edition = 'certified';
let channel;
try {
    const active = await import('./config/active-edition.mjs');
    edition = active.default ?? 'certified';
    channel = active.channel;
} catch (err) {
    // no active edition selected yet: certified default
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') {
        throw err;
    }
}

const { visual, assets, capabilities } = resolveEditionConfig(
    base,
    edition,
    channel
);

export default { ...base, visual, assets, capabilities };
