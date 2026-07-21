import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src', 'utils', 'request', 'index.js'), 'utf8');

const requiredFragments = [
  '[^a-z0-9]+',
  "normalizeMessage(message) === 'requestok'",
  'normalizeNetworkErrorMessage',
  'err_connection_timed_out',
  'rawMsg',
  'custom.toast !== false',
  '!successCodes.includes(code) && !isRequestOkMessage(msg)',
  'isRequestOkMessage(displayMessage)',
  'Promise.resolve'
];

for (const fragment of requiredFragments) {
  if (!source.includes(fragment)) {
    throw new Error(`Request layer is missing request-ok compatibility fragment: ${fragment}`);
  }
}
