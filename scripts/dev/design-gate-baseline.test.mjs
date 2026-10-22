import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as gate from './design-gate.mjs';

test('baseline serialization keeps ordered compact cases and JSON escaping', () => {
  assert.equal(typeof gate.serializeBaseline, 'function');
  const counts = {
    '/z|0|1920x1080|dark': [0, 12, 0, 3, 1],
    '/a"\\\n\t雪': [9, 0, 2, 0, 9007199254740991],
  };
  const expected = '{\n' +
    '"/z|0|1920x1080|dark":[0,12,0,3,1],\n' +
    '"/a\\"\\\\\\n\\t雪":[9,0,2,0,9007199254740991]\n' +
    '}\n';
  const encoded = gate.serializeBaseline(counts);
  assert.equal(encoded, expected);
  assert.deepEqual(JSON.parse(encoded), counts);
  assert.deepEqual(Object.keys(JSON.parse(encoded)), ['/z|0|1920x1080|dark', '/a"\\\n\t雪']);
  assert.equal(gate.serializeBaseline({}), '{\n}\n');
  assert.equal(gate.serializeBaseline({ only: [0, 0, 0, 0, 0] }), '{\n"only":[0,0,0,0,0]\n}\n');
  assert.deepEqual(counts, {
    '/z|0|1920x1080|dark': [0, 12, 0, 3, 1],
    '/a"\\\n\t雪': [9, 0, 2, 0, 9007199254740991],
  });
});

test('committed baseline keeps 396 valid five-count cases and round-trip order', () => {
  const parsed = JSON.parse(readFileSync(new URL('./design-gate.baseline.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(parsed).length, 396, 'committed baseline case count');
  for (const [key, row] of Object.entries(parsed)) {
    assert.ok(Array.isArray(row), `${key}: counts must be an array`);
    assert.equal(row.length, 5, `${key}: exactly five counts required`);
    row.forEach((value, index) => {
      const context = `${key}: count[${index}]`;
      assert.equal(typeof value, 'number', `${context} must be a number`);
      assert.ok(Number.isSafeInteger(value), `${context} must be a safe integer`);
      assert.ok(value >= 0, `${context} must be non-negative`);
    });
  }
  const roundtrip = JSON.parse(gate.serializeBaseline(parsed));
  assert.deepEqual(roundtrip, parsed);
  assert.deepEqual(Object.keys(roundtrip), Object.keys(parsed));
});
