// The markdown that tells the model what to do when Node.js is missing (spec 2026-10-17, parts 2 and 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const step0 = () => {
  const skill = read('skills/setup/SKILL.md');
  return skill.slice(skill.indexOf('### 0. Runtime'), skill.indexOf('### 1. CV import'));
};

test('setup runs the runtime step before setup_status', () => {
  const skill = read('skills/setup/SKILL.md');
  const step0 = skill.indexOf('### 0. Runtime');
  assert.ok(step0 > -1 && step0 < skill.indexOf('### 1. CV import'), 'step 0 comes before CV import');
  assert.match(skill, /scripts\/install-node\.sh" --check/);
  assert.match(skill, /scripts\/install-node\.ps1" -Check/);
  assert.match(skill, /never work around a checksum or signature failure/i);
  assert.match(read('commands/setup.md'), /1\. Run step 0 \(Runtime\) of the skill first\. If step 0 stops, stop here too\./);
});

test('setup step 0 never loops on restarts and never reinstalls over a shadowed Node', () => {
  const s = step0();
  // Exit 0: one restart question, then a diagnosis with the exact Node path instead of another restart.
  assert.match(s, /\*\*Check passes \(exit 0\)\*\*/);
  assert.match(s, /Have you quit and reopened the app since Node\.js was installed\?/);
  assert.match(s, /"<path>" --no-warnings "\$\{CLAUDE_PLUGIN_ROOT\}\/servers\/tracker\/src\/index\.ts" < \/dev\/null/);
  assert.match(s, /\$null \| & "<path>" --no-warnings "\$\{CLAUDE_PLUGIN_ROOT\}\/servers\/tracker\/src\/index\.ts"/);
  assert.match(s, /`stdio ready`[^\n]*https:\/\/github\.com\/adamwardecki\/job-hunt[^\n]*do not suggest another restart/i);
  // Exit 1 is the only route to the installer; exit 3 stops without it.
  assert.match(s, /\*\*Check fails \(exit 1\)\*\*/);
  assert.match(s, /\*\*Exit 3\*\*[^\n]*older copy of Node\.js[^\n]*Do not offer the installer/);
  // Linux has no installer route.
  assert.match(s, /Linux[^\n]*"I'll install it myself"/);
  // After an install, a failing check stops instead of offering the installer again.
  assert.match(s, /run the check again[^\n]*If it still fails, show its message and stop; do not offer the installer again/);
});

test('every tracker command explains a missing runtime in one sentence', () => {
  const missing = /\*\*If the tracker tools are missing\*\* \(search for them first if tools are deferred\), or a hook error says `node` could not start:/;
  for (const name of ['apply', 'status', 'prep', 'cover-letter', 'triage', 'correct', 'import']) {
    assert.match(read(`commands/${name}.md`), new RegExp(missing.source + '.*offer to run `\\/job-hunt:setup`'), name);
  }
  assert.match(read('commands/sweep.md'), new RegExp(missing.source + '.*Record nothing\\.'));
});

test('setup field lists and settings.example.yaml match the config schema', async () => {
  const { CONFIG_SCHEMA } = await import('../servers/tracker/src/config.ts');
  const skill = read('skills/setup/SKILL.md');
  const yaml = read('templates/settings.example.yaml');
  for (const section of ['filters', 'prefs', 'writing', 'accounts', 'schedule', 'sources'] as const) {
    const keys = Object.keys(CONFIG_SCHEMA[section].fields);
    const step = skill.split('\n### ').find((s) => s.includes(`section: "${section}"`)) ?? '';
    // Top-level keys only: nested names like `daily` (`days`, ...) sit in parentheses.
    const line = step.split('\n').find((l) => l.startsWith('- Fields: ')) ?? '';
    const listed = [...line.replace(/\([^)]*\)/g, '').matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    assert.deepEqual(listed, keys, `setup step for ${section}`);
    const block = yaml.slice(yaml.indexOf(`\n${section}:`) + 1).split(/\n(?=[a-z])/)[0] ?? '';
    for (const k of keys) assert.match(block, new RegExp(`\\n  ${k}:`), `settings.example.yaml ${section}.${k}`);
  }
});
