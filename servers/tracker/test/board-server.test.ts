import assert from 'node:assert/strict';
import type { IncomingHttpHeaders } from 'node:http';
import { request } from 'node:http';
import { test } from 'node:test';
import { createBoardServer } from '../src/board-server.ts';
import { seeded } from './board-seed.ts';

const TOKEN = 'a'.repeat(64);

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

async function board({ idleMs = 60_000, onIdle = () => {} }: { idleMs?: number; onIdle?: () => void } = {}) {
  const s = seeded();
  const server = createBoardServer({ tracker: s.t, token: TOKEN, idleMs, onIdle });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const port = addr.port;
  const send = (method: string, path: string, { headers = {}, body }: { headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<Reply>((done, fail) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
      });
      req.on('error', fail);
      req.end(body);
    });
  const auth = { authorization: `Bearer ${TOKEN}` };
  const json = { ...auth, 'content-type': 'application/json' };
  const close = () =>
    new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    });
  return { ...s, port, send, auth, json, close };
}

test('API calls without the token, or with a wrong one, get 401', async () => {
  const b = await board();
  try {
    assert.equal((await b.send('GET', '/api/board')).status, 401);
    assert.equal((await b.send('GET', '/api/health', { headers: { authorization: `Bearer ${'b'.repeat(64)}` } })).status, 401);
    assert.equal((await b.send('GET', '/api/health', { headers: { authorization: 'Bearer short' } })).status, 401);
  } finally {
    await b.close();
  }
});

test('a foreign Host header gets 421, even with the token (DNS rebinding)', async () => {
  const b = await board();
  try {
    assert.equal((await b.send('GET', '/', { headers: { host: `evil.example:${b.port}` } })).status, 421);
    assert.equal((await b.send('GET', '/api/board', { headers: { ...b.auth, host: `evil.example:${b.port}` } })).status, 421);
    assert.equal((await b.send('GET', '/api/health', { headers: { ...b.auth, host: `localhost:${b.port}` } })).status, 200);
  } finally {
    await b.close();
  }
});

test('the page is static, carries no data and sends a strict CSP', async () => {
  const b = await board();
  try {
    const page = await b.send('GET', '/');
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-security-policy']), /default-src 'none'; script-src 'self'/);
    assert.equal(page.headers['referrer-policy'], 'no-referrer');
    assert.equal(page.headers['access-control-allow-origin'], undefined);
    assert.doesNotMatch(page.body, /Northwind/);
    assert.match((await b.send('GET', '/board.js')).headers['content-type'] ?? '', /text\/javascript/);
    assert.match((await b.send('GET', '/board.css')).headers['content-type'] ?? '', /text\/css/);
    assert.equal((await b.send('GET', '/nope')).status, 404);
  } finally {
    await b.close();
  }
});

test('the board data and moves go through the tracker rules', async () => {
  const b = await board();
  try {
    const view = JSON.parse((await b.send('GET', '/api/board', { headers: b.auth })).body);
    assert.ok(view.roles.some((r: { company: string }) => r.company === 'Northwind'));
    const ok = await b.send('POST', '/api/move', { headers: b.json, body: JSON.stringify({ role_id: b.scored, to: 'queued', reason: 'Moved on the board' }) });
    assert.equal(ok.status, 200);
    assert.equal(b.t.roleDetail({ role_id: b.scored }).events.at(-1)?.actor, 'user');
    const illegal = await b.send('POST', '/api/move', { headers: b.json, body: JSON.stringify({ role_id: b.found, to: 'applied', reason: 'r', evidence: 'e' }) });
    assert.equal(illegal.status, 400);
    assert.match(JSON.parse(illegal.body).error, /Illegal transition found → applied/);
    const noEvidence = await b.send('POST', '/api/move', { headers: b.json, body: JSON.stringify({ role_id: b.found, to: 'dropped', reason: 'meh' }) });
    assert.equal(noEvidence.status, 400);
    const viaRule = await b.send('POST', '/api/move', { headers: b.json, body: JSON.stringify({ role_id: b.found, to: 'dropped', reason: 'agency', evidence: `rule:${b.rule}` }) });
    assert.equal(viaRule.status, 200);
    const verified = await b.send('POST', '/api/move', { headers: b.json, body: JSON.stringify({ role_id: b.queued, to: 'verified', reason: 'r' }) });
    assert.equal(verified.status, 400);
  } finally {
    await b.close();
  }
});

test('posts must be JSON, small and well formed', async () => {
  const b = await board();
  try {
    const body = JSON.stringify({ role_id: b.scored, to: 'queued', reason: 'r' });
    assert.equal((await b.send('POST', '/api/move', { headers: { ...b.auth, 'content-type': 'text/plain' }, body })).status, 415);
    assert.equal((await b.send('POST', '/api/move', { headers: b.json, body: '{oops' })).status, 400);
    assert.equal((await b.send('POST', '/api/move', { headers: b.json, body: JSON.stringify({ reason: 'x'.repeat(70 * 1024) }) })).status, 413);
  } finally {
    await b.close();
  }
});

test('the idle timer fires after idleMs without an authenticated API call', async () => {
  let fired: () => void = () => {};
  const idle = new Promise<void>((done) => {
    fired = done;
  });
  const b = await board({ idleMs: 100, onIdle: () => fired() });
  try {
    await idle;
  } finally {
    await b.close();
  }
});
