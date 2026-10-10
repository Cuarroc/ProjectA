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

function verifyStep() {
  const start = workflow.indexOf('- name: Verify updater channel anonymously');
  assert.ok(start >= 0, 'verify step must exist');
  const next = workflow.indexOf('\n      - name:', start);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

function stagingStep() {
  const start = workflow.indexOf('- name: Stage and verify updater candidate anonymously');
  const end = workflow.indexOf('\n      - name: Promote validated updater bytes', start);
  assert.ok(start >= 0 && end > start, 'staging step must exist');
  return workflow.slice(start, end);
}

test('REL-4: verify failure rollback removes the stable mirror release or restores latest', () => {
  const step = verifyStep();
  const rollback = step.slice(step.lastIndexOf('} catch {'));
  assert.ok(rollback.length > 0, 'verify step must have a rollback catch block');
  // Deleting only latest.json leaves releases/latest on a release without a manifest.
  assert.match(rollback, /gh release delete "v\$version" --repo Cuarroc\/ProjectA-updates --yes/);
  assert.doesNotMatch(
    rollback.split('gh release delete "v$version"')[0],
    /delete-asset/,
    'the release delete must be the primary rollback, not the asset delete',
  );
  assert.doesNotMatch(rollback, /vom Mirror-Release entfernen/);
  assert.match(rollback, /releases\/latest/);
});

test('REL-4: staging mirror release is deleted after a successful promote', () => {
  const step = promotionStep();
  assert.match(step, /\$stagingTag = "v\$version-staging"/);
  // Anchored AFTER the promote: removing the post-promote cleanup must go red.
  const promoted = step.slice(step.indexOf('gh release edit $stableTag'));
  assert.ok(promoted.length > 0, 'promote edit must exist');
  assert.match(
    promoted,
    /\$stableCreated = \$false[\s\S]*?gh release delete \$stagingTag --repo Cuarroc\/ProjectA-updates --yes/,
  );
  assert.match(promoted, /::warning::Staging-Release/);
  // A failed promote must not leave the staging release behind either (re-run guard).
  const trap = step.slice(step.indexOf('trap {'), step.indexOf('# Native gh-Aufrufe'));
  assert.match(trap, /gh release delete \$stagingTag/);
  assert.match(trap, /::warning::Staging-Release[\s\S]*?throw \$failure/);
});

test('REL-4: a failed staging upload removes the staging mirror release', () => {
  const step = stagingStep();
  // The flag is set before the create, so a create that exits non-zero after
  // creating the release is cleaned up as well.
  assert.match(step, /\$stagingCreated = \$true[\s\S]*?gh release create \$stagingTag/);
  assert.match(step, /gh release create \$stagingTag[\s\S]*?gh release upload \$stagingTag/);
  const rollback = step.slice(step.lastIndexOf('} catch {'));
  assert.match(rollback, /if \(\$stagingCreated\)[\s\S]*?gh release delete \$stagingTag --repo Cuarroc\/ProjectA-updates --yes/);
  assert.match(rollback, /::warning::Staging-Release/);
  // The guard for a pre-existing staging release must not mark it as ours.
  assert.match(step, /existiert bereits; kein Clobber[\s\S]*?\$stagingCreated = \$true/);
});

test('REL-4: tag version is checked against tauri.conf.json before the gates', () => {
  const check = workflow.indexOf('- name: Check tag matches the app version');
  const gates = workflow.indexOf('- name: Gates (release)', workflow.indexOf('windows-installer:'));
  assert.ok(check > 0 && gates > check, 'version check must precede the installer job gates');
  const step = workflow.slice(check, gates);
  assert.match(step, /src-tauri\/tauri\.conf\.json/);
  assert.match(step, /exit 1/);
});
