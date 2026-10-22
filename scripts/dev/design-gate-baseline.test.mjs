import { test } from 'node:test';
import assert from 'node:assert/strict';
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
