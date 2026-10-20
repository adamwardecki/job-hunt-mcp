// scripts/install-node.sh: newest LTS from index.tab, checksum verified, nothing opened in a dry run,
// --check honours the 22.18 / 23.4 floor and an older Node first on PATH. Runs against a fixture dist dir,
// never the network.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SH = fileURLToPath(new URL('../plugin/scripts/install-node.sh', import.meta.url));
const noBash = process.platform === 'win32' && 'bash script (macOS)';

const HEADER = 'version\tdate\tfiles\tnpm\tv8\tuv\tzlib\topenssl\tmodules\tlts\tsecurity';
const row = (v: string, lts: string) => [v, '2026-10-14', 'osx-x64-pkg,win-x64-msi', '', '', '', '', '', '', lts, '-'].join('\t');

// A fake nodejs.org/dist: v99 is current (not LTS), v98.1.0 is the newest LTS.
// badVersion: the newest LTS row has a version that is not vX.Y.Z (a path traversal attempt).
function fixtureDist({ corrupt = false, badVersion = false }: { corrupt?: boolean; badVersion?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jh-dist-'));
  const rows = [row('v99.0.0', '-'), ...(badVersion ? [row('v1/../../x', 'Evil')] : []), row('v98.1.0', 'Fixture'), row('v97.0.0', 'Older')];
  writeFileSync(join(dir, 'index.tab'), `${[HEADER, ...rows].join('\n')}\n`);
  for (const v of ['v99.0.0', 'v98.1.0', 'v97.0.0']) {
    mkdirSync(join(dir, v));
    const sums = [];
    for (const file of [`node-${v}.pkg`, `node-${v}-x64.msi`, `node-${v}-arm64.msi`]) {
      const body = `fake ${file}`;
      writeFileSync(join(dir, v, file), body);
      sums.push(`${createHash('sha256').update(corrupt ? 'tampered' : body).digest('hex')}  ${file}`);
    }
    writeFileSync(join(dir, v, 'SHASUMS256.txt'), `${sums.join('\n')}\n`);
  }
  return pathToFileURL(dir).href;
}

// fakeNode(null) is a node that fails without printing a version.
function fakeNode(version: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'jh-node-'));
  const file = join(dir, process.platform === 'win32' ? 'node.cmd' : 'node');
  const body = version === null
    ? (process.platform === 'win32' ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n')
    : (process.platform === 'win32' ? `@echo ${version}\r\n` : `#!/bin/sh\necho ${version}\n`);
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return file;
}

// Only what bash needs to start. The script gets no other variables from the test runner's environment.
const BASE_ENV: NodeJS.ProcessEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].flatMap((k) => (process.env[k] === undefined ? [] : [[k, process.env[k]]])));

const sh = (args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync('bash', [SH, ...args], { encoding: 'utf8', env: { ...BASE_ENV, ...env } });

const NO_NODE = { JOB_HUNT_NODE: '/nonexistent/node' };

test('sh: dry run with an old Node picks the newest LTS and verifies the checksum', { skip: noBash }, () => {
  const r = sh(['--dry-run'], { JOB_HUNT_NODE: fakeNode('v22.12.0'), JOB_HUNT_NODE_DIST: fixtureDist() });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Downloading Node\.js v98\.1\.0 \(LTS\)/);
  assert.match(r.stdout, /Checksum ok\./);
  assert.match(r.stdout, /Dry run: would check the signature and open .*node-v98\.1\.0\.pkg/);
  const match = /open (.*node-v98\.1\.0\.pkg)/.exec(r.stdout);
  assert.ok(match?.[1]);
  const opened = match[1];
  assert.equal(existsSync(dirname(opened)), false, 'the temp dir is removed when nothing is opened');
});

test('sh: a checksum mismatch stops before anything is opened', { skip: noBash }, () => {
  const r = sh(['--dry-run'], { ...NO_NODE, JOB_HUNT_NODE_DIST: fixtureDist({ corrupt: true }) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Checksum mismatch for node-v98\.1\.0\.pkg\. Nothing was installed\./);
  assert.doesNotMatch(r.stdout, /Dry run/);
});

test('sh: an unreachable dist is reported in plain words', { skip: noBash }, () => {
  const r = sh(['--dry-run'], { ...NO_NODE, JOB_HUNT_NODE_DIST: 'file:///nonexistent-jh-dist' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Could not reach file:\/\/\/nonexistent-jh-dist/);
});

test('sh: --check enforces Node 22.18 or newer', { skip: noBash }, () => {
  assert.equal(sh(['--check'], { JOB_HUNT_NODE: fakeNode('v22.17.0') }).status, 1);
  assert.match(sh(['--check'], { JOB_HUNT_NODE: fakeNode('v22.17.0') }).stdout, /too old; the plugin needs 22\.18 or newer/);
  assert.equal(sh(['--check'], { JOB_HUNT_NODE: fakeNode('v22.18.0') }).status, 0);
  assert.equal(sh(['--check'], { JOB_HUNT_NODE: fakeNode('v24.22.0') }).status, 0);
  const missing = sh(['--check'], { JOB_HUNT_NODE: '/nonexistent/node' });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /Node\.js is not installed\./);
});

test('sh: installs nothing when Node 22.18+ is already there', { skip: noBash }, () => {
  for (const mode of [[], ['--dry-run']]) {
    const r = sh(mode, { JOB_HUNT_NODE: fakeNode('v24.22.0'), JOB_HUNT_NODE_DIST: 'file:///nonexistent-jh-dist' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Node\.js v24\.22\.0 is installed at .*\. Nothing to install\./);
    assert.doesNotMatch(r.stdout, /Downloading/);
  }
});

test('sh: unknown options are rejected', { skip: noBash }, () => {
  assert.equal(sh(['--yes']).status, 2);
});

test('sh: rejects 23.0-23.3 (no node:sqlite without a flag), accepts 23.4', { skip: noBash }, () => {
  const old = sh(['--check'], { JOB_HUNT_NODE: fakeNode('v23.1.0') });
  assert.equal(old.status, 1);
  assert.match(old.stdout, /too old/);
  assert.equal(sh(['--check'], { JOB_HUNT_NODE: fakeNode('v23.4.0') }).status, 0);
});

test('sh: a Node that does not run is reported as such', { skip: noBash }, () => {
  const r = sh(['--check'], { JOB_HUNT_NODE: fakeNode(null) });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Node\.js at .* did not run\./);
});

test('sh: an older Node first on PATH blocks a newer one in the default location', { skip: noBash }, () => {
  const env = { JOB_HUNT_NODE: fakeNode('v20.0.0'), JOB_HUNT_NODE_DEFAULT: fakeNode('v24.22.0'), JOB_HUNT_NODE_DIST: fixtureDist() };
  const check = sh(['--check'], env);
  assert.equal(check.status, 3, 'shadowed is not the same as missing: installing the LTS would not fix it');
  assert.match(check.stdout, /Node\.js v24\.22\.0 is installed at .*, but an older Node\.js \(v20\.0\.0 at .*\) comes first on PATH/);
  for (const mode of [[], ['--dry-run']]) {
    const r = sh(mode, env);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /comes first on PATH/);
    assert.doesNotMatch(r.stdout, /Downloading/);
  }
});

test('sh: a new Node in the default location but not on PATH is fine', { skip: noBash }, () => {
  const r = sh(['--check'], { ...NO_NODE, JOB_HUNT_NODE_DEFAULT: fakeNode('v24.22.0') });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /Node\.js v24\.22\.0 is installed at .* \(not on PATH yet; reopening the app usually fixes that\)\./);
});

test('sh: an old Node is reported before the LTS is downloaded', { skip: noBash }, () => {
  const r = sh(['--dry-run'], { JOB_HUNT_NODE: fakeNode('v22.12.0'), JOB_HUNT_NODE_DIST: fixtureDist() });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /too old; the plugin needs 22\.18 or newer \(23\.x needs 23\.4 or newer\)\.\nInstalling the current LTS\.\n[\s\S]*Downloading[\s\S]*about 90 MB/);
});

test('sh: an LTS version that is not vX.Y.Z is refused before any download', { skip: noBash }, () => {
  const r = sh(['--dry-run'], { ...NO_NODE, JOB_HUNT_NODE_DIST: fixtureDist({ badVersion: true }) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Could not find a Node\.js LTS release in .*index\.tab\./);
  assert.doesNotMatch(r.stdout, /Downloading/);
});

// Install modes on Linux, with stub `uname` and `curl` first on PATH so nothing can reach the network.
// JOB_HUNT_NODE_DIST must be unset: it skips the macOS-only check (test fixture mode).
function shLinux(args: string[], env: NodeJS.ProcessEnv) {
  const bin = mkdtempSync(join(tmpdir(), 'jh-bin-'));
  const marker = join(bin, 'curled');
  writeFileSync(join(bin, 'uname'), '#!/bin/sh\necho Linux\n');
  writeFileSync(join(bin, 'curl'), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
  chmodSync(join(bin, 'uname'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);
  const full: NodeJS.ProcessEnv = { ...BASE_ENV, ...env, PATH: `${bin}:${process.env.PATH}` };
  delete full.JOB_HUNT_NODE_DIST;
  const r = spawnSync('bash', [SH, ...args], { encoding: 'utf8', env: full });
  return { r, curled: existsSync(marker) };
}

test('sh: on Linux the install modes stop before any download; --check still works', { skip: noBash }, () => {
  for (const mode of [[], ['--dry-run']]) {
    const { r, curled } = shLinux(mode, NO_NODE);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /This installer is for macOS\. On Linux, install Node\.js 22\.18 or newer with your package manager or from https:\/\/nodejs\.org\/en\/download\./);
    assert.equal(curled, false, 'nothing is downloaded');
  }
  assert.equal(shLinux(['--check'], { JOB_HUNT_NODE: fakeNode('v24.22.0') }).r.status, 0);
  assert.equal(shLinux(['--check'], NO_NODE).r.status, 1);
});

// Install mode with stub `open` and `spctl` first on PATH, and a fresh TMPDIR to see what is left behind.
function shInstall(spctlOut: string, spctlExit: number) {
  const bin = mkdtempSync(join(tmpdir(), 'jh-bin-'));
  writeFileSync(join(bin, 'open'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$STUB_OPEN_MARKER"\n');
  writeFileSync(join(bin, 'spctl'), '#!/bin/sh\nprintf \'%s\\n\' "$STUB_SPCTL_OUT" >&2\nexit "$STUB_SPCTL_EXIT"\n');
  chmodSync(join(bin, 'open'), 0o755);
  chmodSync(join(bin, 'spctl'), 0o755);
  const tmp = mkdtempSync(join(tmpdir(), 'jh-tmp-'));
  const marker = join(bin, 'opened');
  const r = sh([], {
    ...NO_NODE, JOB_HUNT_NODE_DIST: fixtureDist(), PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp,
    STUB_OPEN_MARKER: marker, STUB_SPCTL_OUT: spctlOut, STUB_SPCTL_EXIT: String(spctlExit),
  });
  return { r, tmp, opened: existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null };
}

const ACCEPTED = 'node.pkg: accepted\nsource=Notarized Developer ID\norigin=Developer ID Installer: Node.js Foundation (HX7739G8FX)';

test('sh: a package Gatekeeper rejects is never opened and the temp dir is removed', { skip: noBash }, () => {
  const { r, tmp, opened } = shInstall('node.pkg: rejected', 3);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /node-v98\.1\.0\.pkg is not signed and notarized by the Node\.js Foundation\. Nothing was installed\./);
  assert.equal(opened, null);
  assert.deepEqual(readdirSync(tmp), []);
});

test('sh: a package from another publisher is never opened', { skip: noBash }, () => {
  const { r, tmp, opened } = shInstall(ACCEPTED.replace(/origin=.*/, 'origin=Developer ID Installer: Someone Else (ABC)'), 0);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not signed and notarized by the Node\.js Foundation/);
  assert.equal(opened, null);
  assert.deepEqual(readdirSync(tmp), []);
});

test('sh: a notarized Node.js Foundation package is opened and kept', { skip: noBash }, () => {
  const { r, opened } = shInstall(ACCEPTED, 0);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(opened);
  assert.match(opened, /node-v98\.1\.0\.pkg$/);
  assert.ok(existsSync(opened), 'the .pkg survives for the installer');
  assert.match(r.stdout, /The Node\.js installer is open\./);
});
