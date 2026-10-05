import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { loadConfig } from "../src/config.js";
import type { JobManifest } from "../src/contracts.js";
import { createJob, readArtifact, saveManifest } from "../src/jobs.js";

async function fixture(t: TestContext, bytes = Buffer.from("%PDF-1.7\n\0binary\xff", "latin1")) {
  const root = await mkdtemp(resolve(tmpdir(), "structural-mcp-artifacts-"));
  const relativeRoot = relative(resolve(tmpdir()), root);
  assert.ok(!isAbsolute(relativeRoot) && relativeRoot !== ".." && !relativeRoot.startsWith(`..${sep}`));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const config = { ...await loadConfig(), jobRoot: root, maxTextReadBytes: 8191, maxArtifactBytes: 1024 * 1024 };
  const job = await createJob("webdan_calculate", '{"private":"input"}', ".json", config);
  const path = resolve(job.outputDirectory, "report.pdf");
  await writeFile(path, bytes);
  const manifest: JobManifest = {
    schemaVersion: 1,
    jobId: job.jobId,
    tool: "webdan_calculate",
    engine: "webdan2",
    engineVersion: "1.0.0",
    readiness: "stable",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ok: true,
    executionStatus: "completed",
    engineeringStatus: "not-assessed",
    summary: {},
    messages: [],
    errors: [],
    artifacts: [{
      artifactId: "pdf",
      name: "report.pdf",
      mediaType: "application/pdf",
      relativePath: "output/report.pdf",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }],
  };
  await saveManifest(job.directory, manifest);
  const updateManifest = async () => { await writeFile(resolve(job.directory, "manifest.json"), JSON.stringify(manifest)); };
  return { root, config, job, path, bytes, manifest, updateManifest };
}

test("binary artifact chunks reconstruct all bytes and obey the configured read bound", async (t) => {
  const bytes = Buffer.alloc(160 * 1024 + 29);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256;
  const { config, job } = await fixture(t, bytes);
  let offset = 0;
  const chunks: Buffer[] = [];
  do {
    const result = await readArtifact(job.jobId, "pdf", offset, 100_000, config);
    const chunk = Buffer.from(result.base64, "base64");
    assert.equal(result.offsetBytes, offset);
    assert.equal(result.nextOffsetBytes, offset + chunk.length);
    assert.equal(result.totalBytes, bytes.length);
    assert.ok(chunk.length <= config.maxTextReadBytes);
    assert.equal(result.eof, result.nextOffsetBytes === bytes.length);
    chunks.push(chunk);
    offset = result.nextOffsetBytes;
  } while (offset < bytes.length);
  assert.deepEqual(Buffer.concat(chunks), bytes);
});

test("PIK UTF-8 bytes survive chunks that split Japanese characters", async (t) => {
  const bytes = Buffer.from("PICKUP\r\n線路直角方向,断面力,変位\r\n", "utf8");
  const { config, job, path, manifest, updateManifest } = await fixture(t, bytes);
  await rename(path, resolve(job.outputDirectory, "線路直角方向.pik"));
  Object.assign(manifest.artifacts[0]!, {
    artifactId: "pik", name: "線路直角方向.pik", relativePath: "output/線路直角方向.pik", mediaType: "text/plain; charset=utf-8",
  });
  await updateManifest();
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += 2) {
    const chunk = await readArtifact(job.jobId, "pik", offset, 2, config);
    assert.equal(chunk.offsetBytes, offset);
    chunks.push(Buffer.from(chunk.base64, "base64"));
  }
  assert.deepEqual(Buffer.concat(chunks), bytes);
});

test("artifact reads handle empty files, EOF, and offsets beyond EOF", async (t) => {
  const { config, job, bytes } = await fixture(t);
  for (const offset of [bytes.length, bytes.length + 5, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(await readArtifact(job.jobId, "pdf", offset, 1, config), {
      base64: "", offsetBytes: bytes.length, nextOffsetBytes: bytes.length, eof: true, totalBytes: bytes.length,
    });
  }
  const empty = await fixture(t, Buffer.alloc(0));
  assert.deepEqual(await readArtifact(empty.job.jobId, "pdf", 0, 1, empty.config), {
    base64: "", offsetBytes: 0, nextOffsetBytes: 0, eof: true, totalBytes: 0,
  });
});

test("direct callers cannot pass unsafe offsets, chunk sizes, or identifiers", async (t) => {
  const { config, job } = await fixture(t);
  for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(readArtifact(job.jobId, "pdf", offset, 1, config), /offsetBytes/);
  }
  for (const size of [-1, 0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(readArtifact(job.jobId, "pdf", 0, size, config), /maxBytes/);
  }
  for (const id of ["", "../pdf", "output/report.pdf", "pdf\\file"]) {
    await assert.rejects(readArtifact(job.jobId, id, 0, 1, config), /invalid artifactId/);
  }
  await assert.rejects(readArtifact("../manifest.json", "pdf", 0, 1, config), /invalid jobId/);
});

test("only registered artifacts in a matching valid manifest can be read", async (t) => {
  const { config, job, manifest, updateManifest } = await fixture(t);
  await writeFile(resolve(job.outputDirectory, "unregistered.bin"), "not registered");
  for (const id of ["missing", "unregistered", "manifest", "input"]) {
    await assert.rejects(readArtifact(job.jobId, id, 0, 10, config), /artifactId was not found/);
  }
  manifest.jobId = "another-job";
  await updateManifest();
  await assert.rejects(readArtifact(job.jobId, "pdf", 0, 10, config), /invalid job manifest/);
  manifest.jobId = job.jobId;
  manifest.artifacts.push({ ...manifest.artifacts[0]! });
  await updateManifest();
  await assert.rejects(readArtifact(job.jobId, "pdf", 0, 10, config), /duplicate artifactId/);
  await writeFile(resolve(job.directory, "manifest.json"), JSON.stringify({ schemaVersion: 1, jobId: job.jobId, artifacts: [] }));
  await assert.rejects(readArtifact(job.jobId, "pdf", 0, 10, config), /invalid job manifest/);
});

test("manifest paths cannot expose input, manifests, absolute paths, or other jobs", async (t) => {
  const { config, job, path, manifest, updateManifest } = await fixture(t);
  for (const relativePath of ["input/model.json", "manifest.json", "output/../input/model.json", "../output/report.pdf", path]) {
    manifest.artifacts[0]!.relativePath = relativePath;
    await updateManifest();
    await assert.rejects(readArtifact(job.jobId, "pdf", 0, 10, config), /artifact path/);
  }
});

test("directory symlinks cannot escape the artifact output or job root", async (t) => {
  const { root, config, job, manifest, updateManifest } = await fixture(t);
  await symlink(resolve(job.directory, "input"), resolve(job.outputDirectory, "input-link"), "junction");
  manifest.artifacts[0]!.relativePath = "output/input-link/model.json";
  await updateManifest();
  await assert.rejects(readArtifact(job.jobId, "pdf", 0, 10, config), /artifact path escaped/);
  await rename(job.outputDirectory, resolve(job.directory, "original-output"));
  await symlink(resolve(job.directory, "input"), job.outputDirectory, "junction");
  manifest.artifacts[0]!.relativePath = "output/model.json";
  await updateManifest();
  await assert.rejects(readArtifact(job.jobId, "pdf", 0, 10, config), /output path escaped/);

  const restrictedRoot = resolve(root, "restricted");
  const date = job.jobId.slice(0, 10);
  await mkdir(resolve(restrictedRoot, date), { recursive: true });
  await symlink(job.directory, resolve(restrictedRoot, date, job.jobId), "junction");
  await assert.rejects(readArtifact(job.jobId, "pdf", 0, 10, { ...config, jobRoot: restrictedRoot }), /job path escaped/);
});

test("artifact reads reject missing files, size limits, changed sizes, and changed bytes outside the requested chunk", async (t) => {
  const { config, job, path, bytes } = await fixture(t);
  await assert.rejects(readArtifact(job.jobId, "pdf", 0, 1, { ...config, maxArtifactBytes: bytes.length - 1 }), /size limit/);
  const changed = Buffer.from(bytes);
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 0xff;
  await writeFile(path, changed);
  await assert.rejects(readArtifact(job.jobId, "pdf", 0, 1, config), /hash mismatch/);
  await assert.rejects(readArtifact(job.jobId, "pdf", bytes.length, 1, config), /hash mismatch/);
  await writeFile(path, Buffer.concat([bytes, Buffer.from("extra")]));
  await assert.rejects(readArtifact(job.jobId, "pdf", 0, 1, config), /size mismatch/);
  await rm(path);
  await assert.rejects(readArtifact(job.jobId, "pdf", 0, 1, config), /ENOENT/);
});
