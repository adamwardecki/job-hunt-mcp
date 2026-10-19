// tools/list must not change while the code is refactored: clients cache these schemas.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TOOLS } from '../src/tools.ts';

const fixture = new URL('./fixtures/tools-list.json', import.meta.url);

test('tools/list names, descriptions and input schemas are unchanged', () => {
  const current = `${JSON.stringify(TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), null, 2)}\n`;
  assert.equal(current, readFileSync(fixture, 'utf8'));
});
