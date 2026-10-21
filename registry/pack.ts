// Builds the tracker MCP server as an MCPB bundle for a GitHub release, and writes its SHA-256 into
// server.json for the MCP Registry. Maintainer tool; not shipped. Usage: node registry/pack.ts
//
// The bundle carries the TypeScript sources as they are: Node strips types itself (not under node_modules,
// which is why this is not an npm package).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../plugin/servers/tracker/src/tools.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(REPO, 'plugin');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

const manifest = readJson(join(REPO, 'registry', 'manifest.json'));
const out = join(REPO, 'dist', `job-tracker-${manifest.version}.mcpb`);

const stage = mkdtempSync(join(tmpdir(), 'job-tracker-mcpb-'));
try {
  // tools/list is the source of truth; the manifest copy is what hosts show before install.
  manifest.tools = TOOLS.map(({ name, description }) => ({ name, description }));
  writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  copyFileSync(join(PLUGIN, '.claude-plugin', 'icon.png'), join(stage, 'icon.png'));
  copyFileSync(join(PLUGIN, 'LICENSE'), join(stage, 'LICENSE'));
  mkdirSync(join(stage, 'server'));
  copyFileSync(join(PLUGIN, 'servers', 'tracker', 'package.json'), join(stage, 'server', 'package.json'));
  cpSync(join(PLUGIN, 'servers', 'tracker', 'src'), join(stage, 'server', 'src'), { recursive: true });

  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  const zip = spawnSync('zip', ['-qrX', out, '.'], { cwd: stage, stdio: 'inherit' });
  if (zip.status !== 0) throw new Error(`zip failed (status ${zip.status}); is zip installed?`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}

const sha = createHash('sha256').update(readFileSync(out)).digest('hex');
const serverJsonPath = join(REPO, 'server.json');
const server = readJson(serverJsonPath);
server.packages[0].fileSha256 = sha;
writeFileSync(serverJsonPath, `${JSON.stringify(server, null, 2)}\n`);
process.stderr.write(`${out}\nsha256 ${sha} (written to server.json)\n`);
