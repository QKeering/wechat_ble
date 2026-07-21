#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const backendRoot = resolve(projectRoot, '..', '..', 'wechatAdmin', 'admin_fastapi');
const pythonFromVenv = join(backendRoot, '.venv', 'Scripts', 'python.exe');
const pythonBin = existsSync(pythonFromVenv) ? pythonFromVenv : 'python';

const requiredFiles = [
  'app/api/app.py',
  'scripts/check_health_text_response.py',
  'scripts/verify_rw_health_sync.py'
];

if (!existsSync(backendRoot)) {
  console.error(`Backend workspace not found: ${backendRoot}`);
  process.exit(1);
}

for (const file of requiredFiles) {
  const full = join(backendRoot, file);
  if (!existsSync(full)) {
    console.error(`Backend verification file missing: ${full}`);
    process.exit(1);
  }
}

const backendAliasTerms = [
  'heartRateValue',
  'oxygenSaturation',
  'hrvValue',
  'pressureValue',
  'temperatureValue',
  'bloodSugarValue',
  'bloodPressureValue',
  'systolicValue',
  'diastolicValue',
  'sync_blood_pressure_pair',
  'backend_alias_contract_values',
  'health_raw_sleep_state_value',
  'rw_sleep_status_raw_values',
  'non_sleep_status_values',
  'nap_list',
  'rw_numeric_nap_response'
];

const backendSources = [
  readFileSync(join(backendRoot, 'app/api/app.py'), 'utf8'),
  readFileSync(join(backendRoot, 'scripts/verify_rw_health_sync.py'), 'utf8')
].join('\n');
const appSource = readFileSync(join(backendRoot, 'app/api/app.py'), 'utf8');

const missingAliasTerms = backendAliasTerms.filter((term) => !backendSources.includes(term));
if (missingAliasTerms.length > 0) {
  console.error(`Backend RW alias verification terms missing: ${missingAliasTerms.join(', ')}`);
  process.exit(1);
}

const backendFastReturnTerms = [
  'BackgroundTasks',
  'SessionLocal',
  'recalculate_sync_summaries',
  'calculate_summary=False',
  'background_tasks.add_task(recalculate_sync_summaries',
  '"summarySkipped": not calculate_summary',
  'summaryScheduled',
  'data_sync_summary',
  'vital_score_from_summaries',
  '"algorithm": {}'
];

const missingFastReturnTerms = backendFastReturnTerms.filter((term) => !appSource.includes(term));
if (missingFastReturnTerms.length > 0) {
  console.error(`Backend RW fast-return/display fallback terms missing: ${missingFastReturnTerms.join(', ')}`);
  process.exit(1);
}

const appSourceWithoutAlgorithmDefinition = appSource.replace(
  'def algorithm_report(db: Session, user_id: int, start: date, end: date) -> dict:',
  ''
);
if (/algorithm_report\(db/.test(appSourceWithoutAlgorithmDefinition)) {
  console.error('Backend RW business APIs must not synchronously call algorithm_report(db, ...) while serving upload/detail pages.');
  process.exit(1);
}

const steps = [
  ['scripts/check_health_text_response.py', '--sample-only'],
  ['scripts/verify_rw_health_sync.py'],
  ['-m', 'compileall', 'app/api/app.py', 'scripts/check_health_text_response.py', 'scripts/verify_rw_health_sync.py']
];

for (const args of steps) {
  const result = spawnSync(pythonBin, args, {
    cwd: backendRoot,
    stdio: 'inherit',
    shell: false
  });
  if (result.status !== 0) {
    console.error(`Backend RW health verification failed: ${pythonBin} ${args.join(' ')}`);
    process.exit(result.status || 1);
  }
}

console.log('Backend RW health text verification passed.');
