// Fails if the freshly-built bundle contains sanitizer code. Intended to run
// immediately after `npm run package-standalone` (or package-standard). The
// webpack drop is the unzipped bundle; adjust BUNDLE if the drop folder differs.
import { existsSync, readFileSync } from 'node:fs';

const BUNDLE = '.tmp/drop/visual.js';
if (!existsSync(BUNDLE)) {
    console.error(`Bundle not found at ${BUNDLE}. Run a package build first.`);
    process.exit(1);
}

const source = readFileSync(BUNDLE, 'utf8');
// DOMPurify's trusted-types policy name is the literal "dompurify"; postcss
// ships its package name in error/Symbol strings. Either presence means the
// sanitizer subtree leaked into a base-edition bundle.
const fingerprints = [/dompurify/i, /postcss-value-parser/i];
const hits = fingerprints
    .filter((re) => re.test(source))
    .map((re) => re.source);

if (hits.length > 0) {
    console.error(
        `FAIL: sanitizer fingerprint(s) in base bundle: ${hits.join(', ')}`
    );
    process.exit(1);
}
console.log('OK: no sanitizer fingerprint in the base bundle.');
