import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(resolve(root, '.env'))) {
  process.stderr.write('Missing .env. Run npm run setup:env first.\n');
  process.exit(1);
}

function run(command, args, { persistent = false } = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (persistent) return child;
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)));
  });
}

async function healthy(url) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); return response.ok; }
  catch { return false; }
}

async function waitFor(url, child, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await healthy(url)) return;
    if (child.exitCode !== null) throw new Error(`${label} exited before it became ready`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`${label} did not become ready`);
}

let api; let web;
try {
  await run('docker', ['compose', 'up', '-d', '--wait']);
  await run('npm', ['run', 'db:migrate']);
  if (!await healthy('http://127.0.0.1:4000/api/v1/health')) {
    api = run('npm', ['run', 'dev:api'], { persistent: true });
    await waitFor('http://127.0.0.1:4000/api/v1/health', api, 'API');
  }
  if (!await healthy('http://127.0.0.1:3000')) {
    web = run('npm', ['run', 'dev:web'], { persistent: true });
    await waitFor('http://127.0.0.1:3000', web, 'Web app');
  }
  if (!await healthy('http://127.0.0.1:3000/api/v1/health')) throw new Error('The web app cannot reach the API through /api. Check ports 3000 and 4000.');
  process.stdout.write('BellnTell is ready at http://localhost:3000\n');
  if (!api && !web) process.stdout.write('Existing web and API processes are serving this app.\n');
  else await new Promise((resolvePromise) => {
    const stop = () => { api?.kill('SIGTERM'); web?.kill('SIGTERM'); resolvePromise(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    api?.once('exit', stop); web?.once('exit', stop);
  });
} catch (error) {
  api?.kill('SIGTERM'); web?.kill('SIGTERM');
  process.stderr.write(`${error instanceof Error ? error.message : 'Development startup failed'}\n`);
  process.exitCode = 1;
}
