import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = new Set(['README.md', 'SETUP_STATE.md']);
const validSha = value => typeof value === 'string' && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value) && !/^0+$/.test(value);
const full = reason => ({ full: true, count: 0, reason });

export function classifyPaths(paths) {
  if (!paths.length) return full('empty-diff');
  const docsOnly = paths.every(value => DOCS.has(value));
  return { full: !docsOnly, count: paths.length, reason: docsOnly ? 'root-documents-only' : 'code-or-unknown-path' };
}

export function classifyRange({ base, head, pullRequest = false }, git) {
  if (!validSha(base) || !validSha(head)) return full('invalid-or-missing-revision');
  try {
    // Validate both objects; abbreviated refs and unavailable history cannot skip CI.
    git(['cat-file', '-e', `${base}^{commit}`]);
    git(['cat-file', '-e', `${head}^{commit}`]);
    const start = pullRequest ? git(['merge-base', base, head]).toString().trim() : base;
    if (!validSha(start)) return full('invalid-merge-base');
    const output = git(['diff', '--name-only', '-z', '--no-renames', start, head, '--']).toString('utf8');
    if (output && !output.endsWith('\0')) return full('invalid-diff-output');
    return classifyPaths(output ? output.slice(0, -1).split('\0') : []);
  } catch {
    return full('unavailable-git-history');
  }
}

export function classifyEvent(eventName, event, git) {
  if (eventName === 'pull_request') {
    return classifyRange({ base: event?.pull_request?.base?.sha, head: event?.pull_request?.head?.sha, pullRequest: true }, git);
  }
  if (eventName === 'push') return classifyRange({ base: event?.before, head: event?.after }, git);
  return full('unsupported-event');
}

export function main(args = process.argv.slice(2), env = process.env) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = argv => execFileSync('git', argv, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let result;
  if (args.length) {
    if (args.length !== 4 || args[0] !== '--base' || args[2] !== '--head') throw new Error('Usage: node scripts/ci-scope.mjs [--base SHA --head SHA]');
    result = classifyRange({ base: args[1], head: args[3] }, git);
  } else {
    try {
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
      result = classifyEvent(env.GITHUB_EVENT_NAME ?? env.EVENT_NAME, event, git);
    } catch {
      result = full('missing-or-invalid-event');
    }
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `full=${result.full}\n`);
  console.log(`full=${result.full} files=${result.count} reason=${result.reason}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
