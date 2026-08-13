// Fails if the freshly-built bundle contains sanitizer code — or, with
// --expect-sanitizer, if it does NOT. Intended to run immediately after a
// package build (`npm run package-standalone`/`package-standard`, or the
// certified package for --expect-sanitizer). The webpack drop is the unzipped
// bundle; pass a path as the first non-flag argument if the drop folder differs.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const expectSanitizer = args.includes('--expect-sanitizer');
const BUNDLE = args.find((a) => !a.startsWith('--')) ?? '.tmp/drop/visual.js';
if (!existsSync(BUNDLE)) {
    console.error(`Bundle not found at ${BUNDLE}. Run a package build first.`);
    process.exit(1);
}

const source = readFileSync(BUNDLE, 'utf8');
// Fingerprints that witness sanitizer code in a minified bundle: DOMPurify's
// trusted-types policy name is the literal "dompurify"; postcss carries its
// own "postcssPlugin" property name. (postcss-value-parser itself embeds no
// self-referential literal after minification, so it cannot be a witness.)
// Base editions must contain NONE of these; the secure edition must contain
// ALL of them.
const FINGERPRINTS = [/dompurify/i, /postcssPlugin/];

if (expectSanitizer) {
    const missing = FINGERPRINTS.filter((re) => !re.test(source)).map(
        (re) => re.source
    );
    if (missing.length > 0) {
        console.error(
            `FAIL: missing sanitizer fingerprint(s) in secure bundle: ${missing.join(', ')}`
        );
        process.exit(1);
    }
    // The release notes also claim the secure edition "blocks external
    // communication" — assert the packaged capabilities carry no privileges,
    // which is what actually enforces that claim at runtime.
    const capabilities = JSON.parse(
        readFileSync(join(dirname(BUNDLE), 'pbiviz.json'), 'utf8')
    ).capabilities;
    const privileges = capabilities?.privileges ?? [];
    if (privileges.length > 0) {
        console.error(
            `FAIL: secure bundle declares privileges: ${JSON.stringify(privileges)}`
        );
        process.exit(1);
    }
    console.log('OK: sanitizer fingerprints present in the secure bundle.');
} else {
    const hits = FINGERPRINTS.filter((re) => re.test(source)).map(
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
