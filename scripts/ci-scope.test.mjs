import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvent, classifyPaths, classifyRange } from './ci-scope.mjs';

const base = 'a'.repeat(40), head = 'b'.repeat(40), ancestor = 'c'.repeat(40);
const mockGit = (paths, calls = []) => args => {
  calls.push(args);
  if (args[0] === 'merge-base') return Buffer.from(`${ancestor}\n`);
  if (args[0] === 'diff') return Buffer.from(paths.length ? `${paths.join('\0')}\0` : '');
  return Buffer.alloc(0);
};

test('only exact root documents can skip expensive jobs', () => {
  assert.equal(classifyPaths(['README.md', 'SETUP_STATE.md']).full, false);
  for (const file of ['services/README.md', 'model/README.md', '.github/workflows/ci.yml', 'readme.md', '../README.md', 'README.md\nsecret']) {
    assert.equal(classifyPaths(['README.md', file]).full, true);
  }
  assert.equal(classifyPaths([]).full, true);
});

test('PR scope covers complete merge-base diff, including earlier source edits', () => {
  const calls = [];
  const result = classifyEvent('pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }, mockGit(['README.md', 'services/app.py'], calls));
  assert.equal(result.full, true);
  assert.deepEqual(calls.find(args => args[0] === 'diff'), ['diff', '--name-only', '-z', '--no-renames', ancestor, head, '--']);
});

test('push uses entire before/after range and rename retains source deletion', () => {
  const calls = [];
  assert.equal(classifyEvent('push', { before: base, after: head }, mockGit(['services/app.py', 'README.md'], calls)).full, true);
  assert.deepEqual(calls.find(args => args[0] === 'diff').slice(4, 6), [base, head]);
  assert.equal(classifyRange({ base, head }, mockGit(['SETUP_STATE.md'])).full, false);
});

test('invalid, initial, missing and unavailable refs fail closed', () => {
  for (const revision of [undefined, '', 'main', '-x', 'a'.repeat(39), '0'.repeat(40)]) {
    assert.equal(classifyRange({ base: revision, head }, () => { throw new Error('must not inspect invalid refs'); }).full, true);
  }
  assert.equal(classifyRange({ base, head }, () => { throw new Error('missing history'); }).full, true);
  assert.equal(classifyRange({ base, head, pullRequest: true }, args => args[0] === 'merge-base' ? Buffer.from('bad') : Buffer.alloc(0)).full, true);
});

test('unsupported events, empty and malformed diff remain full CI', () => {
  assert.equal(classifyEvent('workflow_dispatch', {}, mockGit(['README.md'])).full, true);
  assert.equal(classifyEvent('pull_request', {}, mockGit(['README.md'])).full, true);
  assert.equal(classifyRange({ base, head }, mockGit([])).full, true);
  assert.equal(classifyRange({ base, head }, args => args[0] === 'diff' ? Buffer.from('README.md') : Buffer.alloc(0)).full, true);
});

test('full SHA-256 object IDs are accepted', () => {
  assert.equal(classifyRange({ base: 'd'.repeat(64), head: 'e'.repeat(64) }, mockGit(['README.md'])).full, false);
});
