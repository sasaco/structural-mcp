import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const buildRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(buildRoot, '../..');
const helper = join(buildRoot, 'payload.mjs');
const digest = data => createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'structural-mcp-integrity-'));
  assert.equal(dirname(root), resolve(tmpdir()));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'server.txt'), 'server');
  const manifest = { files: [{ path: 'server.txt', bytes: 6, sha256: digest('server') }] };
  await writeFile(join(root, 'release-manifest.json'), JSON.stringify(manifest));
  return { root, manifest };
}
function verify(root) { return spawnSync(process.execPath, [helper, 'verify', root], { encoding: 'utf8' }); }

test('staged integrity accepts exactly the recorded payload', async t => {
  const { root } = await fixture(t);
  const result = verify(root);
  assert.equal(result.status, 0, result.stderr);
});
test('staged directory junction cannot redirect output outside installer work root', { skip: process.platform !== 'win32' }, async t => {
  const { root: outside } = await fixture(t);
  const workRoot = join(repoRoot, '.structural-mcp/installer-work');
  await mkdir(workRoot, { recursive: true });
  const container = await mkdtemp(join(workRoot, 'test-junction-'));
  assert.equal(dirname(container), workRoot);
  t.after(() => rm(container, { recursive: true, force: true }));
  const junction = join(container, 'payload');
  await symlink(outside, junction, 'junction');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(buildRoot, 'build-installer.ps1'), '-StagePath', junction, '-SkipMsi', '-Preview'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /StagePath must be an existing payload inside/);
});
test('staged integrity refuses tampering even when byte length is unchanged', async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, 'server.txt'), 'SERVER');
  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Payload differs from manifest/);
});
test('staged integrity refuses extra files', async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, 'personal.env'), 'unexpected');
  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unrecorded payload file/);
});
test('staged integrity refuses paths outside payload', async t => {
  const { root, manifest } = await fixture(t);
  manifest.files[0].path = '../outside.txt';
  await writeFile(join(root, 'release-manifest.json'), JSON.stringify(manifest));
  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Manifest path escapes payload/);
});
test('staged integrity refuses missing recorded files', async t => {
  const { root } = await fixture(t);
  await rm(join(root, 'server.txt'));
  assert.notEqual(verify(root).status, 0);
});
test('preview stage cannot be reused as a release or a different version', { skip: process.platform !== 'win32' }, async t => {
  const workRoot = join(repoRoot, '.structural-mcp/installer-work');
  await mkdir(workRoot, { recursive: true });
  const root = await mkdtemp(join(workRoot, 'test-channel-'));
  // This test-created directory has a known resolved parent and is never supplied by a caller.
  assert.equal(dirname(root), workRoot);
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'release-manifest.json'), JSON.stringify({ version: '0.2.0-preview', channel: 'preview' }));
  const run = extra => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(buildRoot, 'build-installer.ps1'), '-StagePath', root, '-SkipMsi', ...extra], { encoding: 'utf8' });
  const mislabeled = run([]);
  assert.notEqual(mislabeled.status, 0);
  assert.match(mislabeled.stderr, /version\/channel does not match/);
  const matching = run(['-Preview']);
  assert.equal(matching.status, 0, matching.stderr);
  await writeFile(join(root, 'release-manifest.json'), JSON.stringify({ version: '0.1.0-preview', channel: 'preview' }));
  assert.notEqual(run(['-Preview']).status, 0);
});
