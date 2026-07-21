#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const limit = args.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length) || '2000';
const output = args.find((arg) => arg.startsWith('--output='))?.slice('--output='.length) || 'rw-debug-latest.json';
const expectedBuildTag = args.find((arg) => arg.startsWith('--expect-build-tag='))?.slice('--expect-build-tag='.length);
const failOnMissingBuildTag = args.includes('--fail-on-missing-build-tag');
const pageMode = args.includes('--page');

const scriptPath = (name) => path.resolve('scripts', name);
const runNode = (script, scriptArgs) => {
  const result = spawnSync(process.execPath, [scriptPath(script), ...scriptArgs], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 0;
};

const fetchArgs = [`--limit=${limit}`, `--output=${output}`];
if (pageMode) fetchArgs.push('--page');

const fetchStatus = runNode('fetch-rw-backend-log.mjs', fetchArgs);
if (fetchStatus !== 0) process.exit(fetchStatus);

const analyzeArgs = [output];
if (expectedBuildTag) analyzeArgs.push(`--expect-build-tag=${expectedBuildTag}`);
if (failOnMissingBuildTag) analyzeArgs.push('--fail-on-missing-build-tag');

process.exit(runNode('summarize-rw-backend-log.mjs', analyzeArgs));
