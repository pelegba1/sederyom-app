import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Loads server/.env for the DB-backed integration test. No dependency needed. */
const envPath = join(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (key && process.env[key] === undefined) process.env[key] = raw!.replace(/^["']|["']$/g, '');
  }
}
