#!/usr/bin/env node
// Child fixture: hold exclusive ownership until stdin says "release".
import { createInterface } from 'node:readline';
import { acquireOwnership, releaseOwnership } from './ownership.mjs';

const ledgerPath = process.argv[2];
if (!ledgerPath) {
  process.stderr.write('usage: ownership-contender.fixture.mjs <ledgerPath>\n');
  process.exit(2);
}

const session = await acquireOwnership(ledgerPath);
process.stdout.write(`${JSON.stringify({ ready: true })}\n`);

await new Promise((resolve, reject) => {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async line => {
    if (line.trim() !== 'release') return;
    try {
      await releaseOwnership(ledgerPath, session.nonce);
      rl.close();
      resolve();
    } catch (error) {
      reject(error);
    }
  });
  rl.on('close', resolve);
});
process.exit(0);
