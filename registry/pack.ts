// Builds the tracker MCP server as an MCPB bundle for a GitHub release, and writes its SHA-256 into
// server.json for the MCP Registry. Maintainer tool; not shipped.
//
//   node registry/pack.ts           build dist/job-tracker-<version>.mcpb and record its hash in server.json
//   node registry/pack.ts --check   build it and fail unless the hash matches server.json (release.yml)
//
// The bundle carries the TypeScript sources as they are: Node strips types itself (not under node_modules,
// which is why this is not an npm package).
//
// The archive is reproducible: entries sorted, a fixed timestamp and mode, and stored rather than deflated, so
// the bytes depend only on the files and not on the machine, zip version or zlib build. That is what lets CI
// rebuild the bundle and check it against the hash committed in server.json.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { TOOLS } from '../plugin/servers/tracker/src/tools.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(REPO, 'plugin');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

type Entry = { name: string; data: Buffer };

export function bundleEntries(): Entry[] {
  const manifest = readJson(join(REPO, 'registry', 'manifest.json'));
  // tools/list is the source of truth; the manifest copy is what hosts show before install.
  manifest.tools = TOOLS.map(({ name, description }) => ({ name, description }));
  const src = join(PLUGIN, 'servers', 'tracker', 'src');
  return [
    { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    { name: 'icon.png', data: readFileSync(join(PLUGIN, '.claude-plugin', 'icon.png')) },
    { name: 'LICENSE', data: readFileSync(join(PLUGIN, 'LICENSE')) },
    { name: 'server/package.json', data: readFileSync(join(PLUGIN, 'servers', 'tracker', 'package.json')) },
    ...readdirSync(src)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => ({ name: `server/src/${f}`, data: readFileSync(join(src, f)) })),
  ].sort((a, b) => (a.name < b.name ? -1 : 1));
}

// A minimal zip writer: stored entries, no extra fields, 1980-01-01 00:00 timestamps, unix mode 0644.
export function zip(entries: Entry[]): Buffer {
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const fileName = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE((3 << 8) | 20, 4); // made by: unix, 2.0
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(fileName.length, 28);
    header.writeUInt16LE(0, 30); // extra
    header.writeUInt16LE(0, 32); // comment
    header.writeUInt16LE(0, 34); // disk
    header.writeUInt16LE(0, 36); // internal attributes
    header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    parts.push(local, fileName, data);
    central.push(header, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

// Run as a script, not imported by a test. realpath: argv keeps a symlinked path (macOS /tmp), import.meta does not.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { version } = readJson(join(REPO, 'registry', 'manifest.json'));
  const out = join(REPO, 'dist', `job-tracker-${version}.mcpb`);
  const bundle = zip(bundleEntries());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bundle);
  const sha = createHash('sha256').update(bundle).digest('hex');

  const serverJsonPath = join(REPO, 'server.json');
  const server = readJson(serverJsonPath);
  if (check) {
    if (server.packages[0].fileSha256 !== sha) {
      process.stderr.write(`${out}\nsha256 ${sha} does not match server.json (${server.packages[0].fileSha256}). Run node registry/pack.ts and commit server.json.\n`);
      process.exit(1);
    }
    process.stderr.write(`${out}\nsha256 ${sha} matches server.json\n`);
  } else {
    server.packages[0].fileSha256 = sha;
    writeFileSync(serverJsonPath, `${JSON.stringify(server, null, 2)}\n`);
    process.stderr.write(`${out}\nsha256 ${sha} (written to server.json)\n`);
  }
}
