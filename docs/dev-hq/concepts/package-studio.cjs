const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(path.join(out, 'sources'), {recursive: true});
fs.mkdirSync(path.resolve(out, '../fonts'), {recursive: true});
const replacements = [
  ['../../PLAN.md', 'sources/PLAN.md'],
  ['../../../.pa/task_multi_harness.md', 'sources/task_multi_harness.md'],
  ['../../../STAND.md', 'sources/STAND.md'],
  ['../../development/HQ2_CONTRACT.md', 'sources/HQ2_CONTRACT.md'],
  ['../../../.pa/report_hq2-02.md', 'sources/report_hq2-02.md'],
  ['../../../package.json', 'sources/package.json']
];
for(const name of ['hq2-studio.html', 'studio-analysis.js']) {
  let text = fs.readFileSync(path.join(__dirname, name), 'utf8');
  for(const [from, to] of replacements) text = text.replaceAll(from, to);
  if(name.endsWith('.html')) text = text.replace('<html lang="de"', '<html lang="de" data-portable="true"');
  fs.writeFileSync(path.join(out, name.endsWith('.html') ? 'index.html' : name), text);
}
for(const name of ['studio-workspace.css', 'studio-workspace.js', 'studio-model.js', 'studio-premium.css', 'dev-hq-mark-v1.png', 'dev-hq-convergence-v1.png', 'dev-hq-architecture-v1.png']) fs.copyFileSync(path.join(__dirname, name), path.join(out, name));
for(const [from, to] of replacements) fs.copyFileSync(path.resolve(__dirname, from), path.join(out, to));
fs.copyFileSync(path.resolve(__dirname, '../fonts/recursive-latin-wght.woff2'), path.resolve(out, '../fonts/recursive-latin-wght.woff2'));
console.log('Studio artifact packaged: ' + out);
