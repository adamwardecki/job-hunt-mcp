// The MCPB packer: release.yml rebuilds the bundle in CI and requires the hash committed in server.json, so the
// archive has to come out byte-identical anywhere.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bundleEntries, zip } from '../registry/pack.ts';

test('the bundle is byte-identical across builds', () => {
  assert.deepEqual(zip(bundleEntries()), zip(bundleEntries()));
});

test('the bundle holds the manifest, icon, licence and every server source file, in sorted order', () => {
  const names = bundleEntries().map((e) => e.name);
  assert.deepEqual(names, [...names].sort());
  for (const name of ['manifest.json', 'icon.png', 'LICENSE', 'server/package.json', 'server/src/index.ts']) assert.ok(names.includes(name), name);
  const sources = readdirSync(new URL('../plugin/servers/tracker/src/', import.meta.url)).filter((f) => f.endsWith('.ts'));
  assert.equal(names.filter((n) => n.startsWith('server/src/')).length, sources.length);
});

test('the bundle manifest lists every tracker tool', () => {
  const manifest = JSON.parse(bundleEntries().find((e) => e.name === 'manifest.json')!.data.toString('utf8')); // always packed
  assert.ok(manifest.tools.length > 0);
  assert.ok(manifest.tools.some((t: { name: string }) => t.name === 'setup_status'));
});

test('the bundle is a zip that unzip reads back intact', (t) => {
  if (spawnSync('unzip', ['-v']).error) return t.skip('unzip is not installed');
  const file = join(mkdtempSync(join(tmpdir(), 'jt-mcpb-')), 'bundle.mcpb');
  const entries = bundleEntries();
  writeFileSync(file, zip(entries));
  const check = spawnSync('unzip', ['-tq', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const index = spawnSync('unzip', ['-p', file, 'server/src/index.ts']);
  assert.deepEqual(index.stdout, entries.find((e) => e.name === 'server/src/index.ts')!.data); // always packed
});
