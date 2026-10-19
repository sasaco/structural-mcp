import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const [requestedRoot, mode] = process.argv.slice(2);
assert(requestedRoot && isAbsolute(requestedRoot), "Specify an absolute payload root");
assert(mode === undefined || mode === "--allow-runtime-state", "Unexpected verification option");
const root = resolve(requestedRoot);
const manifest = JSON.parse(await readFile(join(root, "release-manifest.json"), "utf8"));
assert.equal(manifest.schemaVersion, 1);
const expected = new Set(["release-manifest.json"]);
for (const file of manifest.files) expected.add(file.path.replaceAll("\\", "/"));
let nextFile = 0;
async function verifyFiles() {
  for (;;) {
    const file = manifest.files[nextFile++];
    if (!file) return;
    const target = resolve(root, file.path);
    assert(!isAbsolute(file.path) && relative(root, target) && !relative(root, target).startsWith(".."));
    const bytes = await readFile(target);
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.path);
  }
}
await Promise.all(Array.from({ length: 16 }, verifyFiles));
let files = 0;
const runtimeStateFiles = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), "Payload contains a symlink");
    const target = join(directory, entry.name);
    if (entry.isDirectory()) await walk(target);
    else {
      const relativeName = relative(root, target).replaceAll("\\", "/");
      if (mode === "--allow-runtime-state" && ["codex-registration-state.json", "skills-install-state.json"].includes(relativeName)) {
        assert(entry.isFile());
        runtimeStateFiles.push(relativeName);
        continue;
      }
      assert(entry.isFile() && expected.has(relativeName), `Unlisted file: ${target}`);
      files++;
    }
  }
}
await walk(root);
assert.equal(files, expected.size);
process.stdout.write(JSON.stringify({ ok: true, root, verifiedManifestFiles: manifest.files.length, totalFiles: files, runtimeStateFiles }) + "\n");
