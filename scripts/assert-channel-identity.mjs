// Asserts the freshly-packaged drop carries the expected channel identity
// (GUID prefix + displayName suffix + stamped version). Guards the
// select-edition → active-edition → pbiviz.mjs handoff: if the channel were
// silently dropped anywhere along it, the package would carry the
// PRODUCTION visual ID and must never be published as a channel build.
import { readFileSync } from 'node:fs';

const prefix = process.argv[2];
if (!prefix) {
    console.error('Usage: node scripts/assert-channel-identity.mjs <PREFIX>');
    process.exit(1);
}
const visual = JSON.parse(
    readFileSync('.tmp/drop/pbiviz.json', 'utf8')
).visual;
const suffix = ` (${prefix[0]}${prefix.slice(1).toLowerCase()})`;
const problems = [];
if (!visual.guid.startsWith(prefix)) {
    problems.push(`GUID '${visual.guid}' lacks prefix '${prefix}'`);
}
if (!visual.displayName.endsWith(suffix)) {
    problems.push(`displayName '${visual.displayName}' lacks suffix '${suffix}'`);
}
// The 4th version segment is the channel build stamp written by buildStamp()
// in scripts/select-edition.mjs — the regex here and the format there must
// change together.
const stampTail = visual.version.split('.').slice(3).join('.');
if (!/^\d{8}#[0-9a-f]{7,}$/.test(stampTail)) {
    problems.push(
        `version '${visual.version}' lacks a channel build stamp (expected 4th segment YYYYMMDD#hash)`
    );
}
if (problems.length > 0) {
    console.error(`FAIL: packaged channel identity: ${problems.join('; ')}`);
    process.exit(1);
}
console.log(
    `OK: channel identity ${visual.guid} / '${visual.displayName}' @ ${visual.version}`
);
