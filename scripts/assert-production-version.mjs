// Asserts the freshly-packaged drop carries the committed (unstamped)
// production version — the mirror of assert-channel-identity.mjs's stamp
// check. Usage: node scripts/assert-production-version.mjs <expected-version>
import { readFileSync } from 'node:fs';

const expected = process.argv[2];
if (!expected) {
    console.error(
        'Usage: node scripts/assert-production-version.mjs <expected-version>'
    );
    process.exit(1);
}
const visual = JSON.parse(readFileSync('.tmp/drop/pbiviz.json', 'utf8')).visual;
if (visual.version !== expected) {
    console.error(
        `FAIL: packaged version '${visual.version}' != expected production version '${expected}'`
    );
    process.exit(1);
}
console.log(`OK: production version ${visual.version}`);
