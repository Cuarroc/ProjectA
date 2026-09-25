import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflow = readFileSync(
  join(process.cwd(), '.github', 'workflows', 'release.yml'),
  'utf8',
);

function promotionStep() {
  const start = workflow.indexOf('- name: Promote validated updater bytes');
  const end = workflow.indexOf('\n      - name: Verify updater channel', start);
  assert.ok(start >= 0 && end > start, 'promotion step must exist');
  return workflow.slice(start, end);
}

test('stable promotion cleans up a newly-created prerelease on failure', () => {
  const step = promotionStep();
  assert.match(step, /\$stableCreated = \$false[\s\S]*?trap \{/);
  assert.match(step, /gh release delete \$stableTag[\s\S]*?throw \$failure/);
  assert.match(step, /gh release create \$stableTag[\s\S]*?\$stableCreated = \$true/);
  assert.match(step, /gh release edit \$stableTag[\s\S]*?\$stableCreated = \$false/);
});
