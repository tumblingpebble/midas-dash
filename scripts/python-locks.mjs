#!/usr/bin/env node
// Resolve only copied dependency manifests in a disposable Linux container.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, copyFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const allowed = new Set(['--check', '--upgrade']);
if (args.some(arg => !allowed.has(arg)) || new Set(args).size !== args.length || args.length > 1) {
  console.error('Usage: node scripts/python-locks.mjs [--check | --upgrade]');
  process.exit(2);
}
const check = args.includes('--check');
const upgrade = args.includes('--upgrade');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['build', 'base', 'sentiment'];
const manifest = name => `requirements.${name}.txt`;
const lock = name => `requirements.${name}.lock.txt`;
const canonicalLF = content => Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
let owned;

function pins(text, label, requireHashes = true) {
  const logical = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  const result = new Map();
  for (const line of logical) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*)==([^\s;]+)(?:\s*;[^]*?)?(?=\s+--hash=|$)/.exec(value);
    if (!match || (requireHashes && !/--hash=sha256:[a-f0-9]{64}(?:\s|$)/.test(value))) {
      throw new Error(`${label}: expected exact package pins with SHA-256 hashes`);
    }
    const name = match[1].toLowerCase().replace(/[-_.]+/g, '-');
    if (result.has(name) && result.get(name) !== match[2]) throw new Error(`${label}: conflicting ${name} versions`);
    result.set(name, match[2]);
  }
  if (!result.size) throw new Error(`${label}: empty lock`);
  return result;
}

function assertOverlap(parent, child, label) {
  for (const [name, version] of parent) {
    if (child.get(name) !== version) throw new Error(`${label}: missing or conflicting inherited pin ${name}`);
  }
}

try {
  const tempRoot = await realpath(tmpdir());
  owned = await mkdtemp(path.join(tempRoot, 'midas-python-locks-'));
  const originals = new Map();
  for (const name of names) {
    await copyFile(path.join(root, manifest(name)), path.join(owned, manifest(name)));
    try {
      const content = await readFile(path.join(root, lock(name)));
      originals.set(name, content);
      // Existing outputs are uv's preferred pins unless --upgrade is explicit.
      pins(content.toString('utf8'), lock(name), check);
      await writeFile(path.join(owned, lock(name)), content);
    } catch (error) {
      if (error.code !== 'ENOENT' || check) throw error;
    }
  }
  const commands = [
    'python -m pip install --no-cache-dir --index-url https://pypi.org/simple uv==0.12.21',
    ...names.map((name, index) => {
      const constraints = index ? ` --constraint ${lock(names[index - 1])}` : '';
      return `uv pip compile --no-config --no-header --no-annotate --generate-hashes --index-url https://pypi.org/simple --python-version 3.11 --python-platform x86_64-unknown-linux-gnu${upgrade ? ' --upgrade' : ''}${constraints} --output-file ${lock(name)} ${manifest(name)} > /dev/null`;
    }),
  ];
  const run = spawnSync('docker', ['run', '--rm', '--platform', 'linux/amd64',
    '--mount', `type=bind,source=${owned},target=/work`, '--workdir', '/work',
    'python:3.11-slim', 'sh', '-eu', '-c', commands.join('\n')], { stdio: 'inherit' });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`Disposable lock compiler failed (exit ${run.status ?? 'signal'})`);
  const outputs = new Map();
  const parsed = new Map();
  for (const name of names) {
    const content = await readFile(path.join(owned, lock(name)));
    outputs.set(name, content);
    parsed.set(name, pins(content.toString('utf8'), lock(name)));
  }
  assertOverlap(parsed.get('build'), parsed.get('base'), 'build/base');
  assertOverlap(parsed.get('base'), parsed.get('sentiment'), 'base/sentiment');
  if (check) {
    // Compare bytes after canonical LF conversion; tolerate Windows CRLF checkout.
    const stale = names.filter(name => !canonicalLF(outputs.get(name)).equals(canonicalLF(originals.get(name))));
    if (stale.length) throw new Error(`Stale dependency locks: ${stale.map(lock).join(', ')}. Regenerate with this helper.`);
  } else {
    // Validate every output before modifying any repository lock.
    for (const name of names) await writeFile(path.join(root, lock(name)), outputs.get(name));
  }
  console.log(`${check ? 'Verified' : 'Generated'} Python 3.11/Linux amd64 locks: ${names.map(name => `${name}=${parsed.get(name).size}`).join(', ')} packages`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (owned) {
    // Resolve and verify the exact owned directory before recursive deletion.
    const resolved = await realpath(owned);
    const tempRoot = await realpath(tmpdir());
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('midas-python-locks-')) {
      console.error('Refusing cleanup outside the owned temporary directory');
      process.exitCode = 1;
    } else {
      await rm(resolved, { recursive: true, force: true });
    }
  }
}
