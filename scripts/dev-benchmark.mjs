#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TASKS, runDevelopmentBenchmark } from './lib/dev-benchmark.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

try {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm run dev:benchmark -- --adapter <module.mjs> --output <result.json>');
  } else if (!option('--adapter') && !option('--output')) {
    console.log(JSON.stringify({ schemaVersion: 1, status: 'not-measured', tasks: TASKS }, null, 2));
  } else {
    const adapterPath = option('--adapter');
    const outputPath = option('--output');
    if (!adapterPath || !outputPath) throw new Error('--adapter and --output are required together');
    const loaded = await import(pathToFileURL(resolve(adapterPath)).href);
    const runTask = loaded.runTask ?? loaded.default;
    const result = await runDevelopmentBenchmark(runTask, adapterPath);
    writeFileSync(resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result));
    if (result.summary.passed !== result.summary.total) process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
