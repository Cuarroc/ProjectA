#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { CASES, compareDevelopmentRuns } from './lib/dev-benchmark.mjs';
try {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.log(JSON.stringify({ schemaVersion: 1, status: 'not-measured', cases: CASES,
      usage: 'npm run dev:benchmark -- baseline.json candidate.json',
      fields: ['caseId', 'runId', 'source=measured', 'evidence', 'tokens', 'elapsedMs', 'accepted', 'reviewRejections', 'rework', 'escapedRegressions'] }, null, 2));
  } else {
    if (paths.length !== 2) throw new Error('Provide baseline and candidate JSON arrays');
    const result = compareDevelopmentRuns(...paths.map(path => JSON.parse(readFileSync(path, 'utf8'))));
    console.log(JSON.stringify(result, null, 2));
    if (result.recommendation !== 'eligible-for-review') process.exitCode = 1;
  }
} catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
