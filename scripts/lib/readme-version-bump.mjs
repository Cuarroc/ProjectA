// scripts/lib/readme-version-bump.mjs <readme> <x.y.z>
// Rewrites the "- **App-Version:** `vX.Y.Z`" line; exits 1 when it is missing
// (String.replace would silently succeed). Called by scripts/release.cmd.
import { readFileSync, writeFileSync } from "node:fs";

const [file, version] = process.argv.slice(2);
if (!file || !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: readme-version-bump.mjs <readme> <x.y.z>");
  process.exit(2);
}
const line = /^- \*\*App-Version:\*\* `v\d+\.\d+\.\d+`/m;
const text = readFileSync(file, "utf8");
if (!line.test(text)) {
  console.error(`${file}: App-Version line not found`);
  process.exit(1);
}
writeFileSync(file, text.replace(line, `- **App-Version:** \`v${version}\``));
