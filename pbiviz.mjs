// Honored by powerbi-visuals-tools (>=6.0.0): a `.mjs` config is dynamically
// imported in preference to the `.json`. This computes the per-edition pbiviz
// config from `config/editions.mjs` + the active edition written by
// scripts/select-edition.mjs. Defaults to `certified` when no edition is selected.
import { readFileSync } from 'node:fs';
import { editions } from './config/editions.mjs';

const base = JSON.parse(
    readFileSync(new URL('./pbiviz.json', import.meta.url), 'utf8')
);

let edition = 'certified';
try {
    edition =
        (await import('./config/active-edition.mjs')).default ?? 'certified';
} catch {
    /* no active edition selected yet: certified default */
}

const e = editions[edition] ?? editions.certified;

export default {
    ...base,
    visual: { ...base.visual, ...e.visual },
    assets: { ...base.assets, ...e.assets },
    capabilities: e.capabilities ?? base.capabilities
};
