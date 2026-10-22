// Sesije preživljavaju ponovno pokretanje poslužitelja (zaseban proces), a na disku nema tokena.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'praksa-sesije-'));
const serverJs = new URL('../src/server.js', import.meta.url).href;

// Pokreće poslužitelj u zasebnom procesu i vraća { port, stop }.
async function startServer() {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `const { start } = await import(${JSON.stringify(serverJs)}); const { port } = await start({ port: 0 }); console.log('PORT=' + port);`], {
    env: { ...process.env, PRAKSA_DATA_DIR: tmp, PRAKSA_BUNDLED_AUTH: path.join(tmp, 'nema.json'), PRAKSA_PRICING_REFRESH: '0', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (c) => { out += c; const m = /PORT=(\d+)/.exec(out); if (m) resolve(Number(m[1])); });
    child.on('exit', (code) => reject(new Error(`poslužitelj je završio (${code})`)));
  });
  return { port, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}

const call = async (port, p, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0] };
};

test('prijava vrijedi i nakon ponovnog pokretanja; odjava također', async () => {
  let s = await startServer();
  const { cookie } = await call(s.port, '/api/auth/postavljanje', { method: 'POST', body: { korisnik: 'admin', lozinka: 'admin-lozinka-1' } });
  assert.equal((await call(s.port, '/api/predmeti', { cookie })).status, 200);
  await s.stop();

  const raw = await fs.readFile(path.join(tmp, 'sesije.json'), 'utf8');
  assert.ok(!raw.includes(cookie.split('=')[1]), 'na disku nije sam token');

  s = await startServer();
  assert.equal((await call(s.port, '/api/predmeti', { cookie })).status, 200, 'sesija je preživjela ponovno pokretanje');
  await call(s.port, '/api/auth/odjava', { method: 'POST', cookie });
  await s.stop();

  s = await startServer();
  assert.equal((await call(s.port, '/api/predmeti', { cookie })).status, 401, 'odjava se također pamti');
  await s.stop();
});

test.after(() => fs.rm(tmp, { recursive: true, force: true }));
