#!/usr/bin/env node
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

const args = process.argv.slice(2);
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const outputArg = args.find((arg) => arg.startsWith('--output='));
const pageMode = args.includes('--page');

const limit = Math.min(2000, Math.max(1, Number(limitArg?.slice('--limit='.length)) || 2000));
const outputPath = path.resolve(outputArg?.slice('--output='.length) || (pageMode ? 'rw-debug-page-latest.html' : 'rw-debug-latest.json'));
const pathname = pageMode ? '/api/app/rw-debug/logs/page' : '/api/app/rw-debug/logs';
const url = new URL(`https://sh.qkeering.com${pathname}`);
url.searchParams.set('limit', String(limit));
url.searchParams.set('_ts', String(Date.now()));

const fetchText = (targetUrl) =>
  new Promise((resolve, reject) => {
    const request = https.get(
      targetUrl,
      {
        headers: {
          'user-agent': 'smart-wearable-devices-next-rw-log-fetch/1.0'
        }
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode || 0}: ${body.slice(0, 300)}`));
            return;
          }
          resolve(body);
        });
      }
    );
    request.setTimeout(30000, () => {
      request.destroy(new Error('RW backend log fetch timed out after 30000ms.'));
    });
    request.on('error', reject);
  });

try {
  const body = await fetchText(url);
  fs.writeFileSync(outputPath, body, 'utf8');
  console.log(`RW backend logs fetched: ${url.toString()}`);
  console.log(`output: ${outputPath}`);
  console.log(`bytes: ${Buffer.byteLength(body, 'utf8')}`);
} catch (error) {
  console.error(`Failed to fetch RW backend logs: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
