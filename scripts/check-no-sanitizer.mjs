// Fails if the freshly-built bundle contains sanitizer code — or, with
// --expect-sanitizer, if it does NOT. Intended to run immediately after a
// package build (`npm run package-standalone`/`package-standard`, or the
// certified package for --expect-sanitizer). The webpack drop is the unzipped
// bundle; pass a path as the first non-flag argument if the drop folder differs.
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const expectSanitizer = args.includes('--expect-sanitizer');
const BUNDLE = args.find((a) => !a.startsWith('--')) ?? '.tmp/drop/visual.js';
if (!existsSync(BUNDLE)) {
    console.error(`Bundle not found at ${BUNDLE}. Run a package build first.`);
    process.exit(1);
}

const source = readFileSync(BUNDLE, 'utf8');
// Fingerprints that indicate sanitizer code in a bundle. DOMPurify's
// trusted-types policy name is the literal "dompurify" and survives
// minification; postcss's package-name strings can also surface in base
// bundles. For the ABSENCE check (base editions), either one leaking is a
// failure. For the PRESENCE check (--expect-sanitizer, secure edition), only
// dompurify is a reliable witness: postcss-value-parser contains no
// self-referential literal in minified output, so its absence proves
// nothing. Both deps enter through the same backend.certified seam, so one
// witness suffices.
const LEAK_FINGERPRINTS = [/dompurify/i, /postcss-value-parser/i];
const PRESENCE_FINGERPRINT = /dompurify/i;

if (expectSanitizer) {
    if (!PRESENCE_FINGERPRINT.test(source)) {
        console.error(
            `FAIL: sanitizer fingerprint (${PRESENCE_FINGERPRINT.source}) missing from secure bundle.`
        );
        process.exit(1);
    }
    console.log('OK: sanitizer fingerprint present in the secure bundle.');
} else {
    const hits = LEAK_FINGERPRINTS.filter((re) => re.test(source)).map(
        (re) => re.source
    );
    if (hits.length > 0) {
        console.error(
            `FAIL: sanitizer fingerprint(s) in base bundle: ${hits.join(', ')}`
        );
        process.exit(1);
    }
    console.log('OK: no sanitizer fingerprint in the base bundle.');
}
