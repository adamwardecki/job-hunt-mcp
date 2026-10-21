// The MCPB bundle (registry/pack.ts): reproducible, valid, and startable the way Claude Desktop starts it.
// release.yml rebuilds the bundle in CI and requires the hash committed in server.json, and a bundle that only
// fails inside the host (0.3.1 did) is otherwise caught by users.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleEntries, type Entry, zip } from '../registry/pack.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MCPB = join(REPO, 'dev', 'node_modules', '@anthropic-ai', 'mcpb', 'dist');

let built: Entry[] | undefined;
const entries = () => (built ??= bundleEntries());
const entry = (name: string) => entries().find((e) => e.name === name);

function unpack(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jt-mcpb-'));
  for (const { name, data } of entries()) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), data);
  }
  return dir;
}

test('the bundle is byte-identical across builds', () => {
  assert.deepEqual(zip(bundleEntries()), zip(entries()));
});

test('the bundle ships the server compiled to JavaScript, one file per source', () => {
  const names = entries().map((e) => e.name);
  assert.deepEqual(names, [...names].sort());
  for (const name of ['manifest.json', 'icon.png', 'LICENSE', 'server/package.json', 'server/index.js']) assert.ok(names.includes(name), name);
  assert.equal(names.filter((n) => n.endsWith('.ts')).length, 0, 'no TypeScript in the bundle');
  const sources = readdirSync(join(REPO, 'plugin', 'servers', 'tracker', 'src')).filter((f) => f.endsWith('.ts'));
  assert.deepEqual(names.filter((n) => n.endsWith('.js')), sources.map((f) => `server/${f.replace(/\.ts$/, '.js')}`).sort());
  const index = entry('server/index.js')!.data.toString('utf8'); // asserted above
  assert.match(index, /from '\.\/db\.js'/, 'relative imports are rewritten to .js');
  assert.equal(JSON.parse(entry('server/package.json')!.data.toString('utf8')).type, 'module');
});

test('the bundle manifest passes mcpb validate and lists every tracker tool', () => {
  const dir = unpack();
  const res = spawnSync(process.execPath, [join(MCPB, 'cli', 'cli.js'), 'validate', join(dir, 'manifest.json')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const manifest = JSON.parse(entry('manifest.json')!.data.toString('utf8')); // always packed
  assert.ok(manifest.tools.some((t: { name: string }) => t.name === 'setup_status'));
  assert.ok(existsSync(join(dir, manifest.server.entry_point)), 'entry_point is in the bundle');
});

test('the bundle starts the way Claude Desktop starts it and answers over stdio', async () => {
  const dir = unpack();
  const manifest = JSON.parse(entry('manifest.json')!.data.toString('utf8')); // always packed
  const { getMcpConfigForManifest } = await import(pathToFileURL(join(MCPB, 'index.js')).href);
  const config = await getMcpConfigForManifest({ manifest, extensionPath: dir, systemDirs: {}, userConfig: {}, pathSeparator: '/' });
  // Desktop's built-in Node takes `node <entry> ...rest`, imports <entry> and hands it the rest (nodeHost.js).
  assert.equal(config.command, 'node');
  const [main, ...rest] = config.args as string[];
  assert.ok(main && !relative(dir, main).startsWith('..') && existsSync(main), `entry ${main} is a file in the bundle`);
  const host = join(mkdtempSync(join(tmpdir(), 'jt-host-')), 'host.mjs');
  writeFileSync(host, `import { pathToFileURL } from 'node:url';
const [entry, ...rest] = process.argv.slice(2);
process.argv = ['node', entry, ...rest];
await import(pathToFileURL(entry).href);
`);
  const home = mkdtempSync(join(tmpdir(), 'jt-home-'));
  const input = [
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'setup_status', arguments: {} } },
  ].map((m) => `${JSON.stringify(m)}\n`).join('');
  const res = spawnSync(process.execPath, [host, main, ...rest], {
    input,
    cwd: tmpdir(),
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...config.env },
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.equal(res.status, 0, res.stderr);
  const replies = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(replies.map((r) => r.id), [0, 1, 2]);
  assert.equal(replies[0].result.serverInfo.version, manifest.version);
  assert.ok(replies[1].result.tools.length > 0);
  assert.equal(replies[2].result.isError, false);
  assert.ok(existsSync(join(home, '.job-tracker', 'tracker.db')), 'the database lands in ~/.job-tracker');
});

test('the bundle is a zip that unzip reads back intact', (t) => {
  if (spawnSync('unzip', ['-v']).error) return t.skip('unzip is not installed');
  const file = join(mkdtempSync(join(tmpdir(), 'jt-mcpb-')), 'bundle.mcpb');
  writeFileSync(file, zip(entries()));
  const check = spawnSync('unzip', ['-tq', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const index = spawnSync('unzip', ['-p', file, 'server/index.js']);
  assert.deepEqual(index.stdout, entry('server/index.js')!.data); // always packed
});
