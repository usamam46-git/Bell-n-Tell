import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const output = template.replace('replace-with-at-least-32-random-characters', randomBytes(32).toString('base64url'));
writeFileSync(new URL('../.env', import.meta.url), output, { flag: 'wx', mode: 0o600 });
process.stdout.write('Created local .env with a random authentication hash key.\n');
