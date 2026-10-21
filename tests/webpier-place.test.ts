import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "../..");
interface Placed { files: string[]; replacedFolders: string[]; overwritten: string[] }
const { place } = await import(pathToFileURL(resolve(repositoryRoot, "skills/structural-webpier/scripts/place-webpier-outputs.mjs")).href) as {
  place(options: { jobRoot: string; jobId: string; project: string; overwrite?: boolean; dryRun?: boolean }): Promise<Placed>;
};

const jobId = "2026-10-19_0f8a2c1e-1234-4abc-9def-0123456789ab";

async function job(files: Record<string, string>, changes: Record<string, unknown> = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "webpier-place-"));
  const directory = resolve(root, "jobs", "2026-10-19", jobId);
  const artifacts = [];
  for (const [relativePath, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    await mkdir(dirname(resolve(directory, relativePath)), { recursive: true });
    await writeFile(resolve(directory, relativePath), data);
    artifacts.push({ artifactId: relativePath, name: relativePath, mediaType: "application/octet-stream", relativePath,
      bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
  }
  await writeFile(resolve(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 1, jobId, tool: "webpier_generate", engine: "webpier", ok: true, executionStatus: "success",
    engineeringStatus: "ok", artifacts, ...changes,
  }));
  const project = resolve(root, "P7");
  await mkdir(project);
  return { root, jobRoot: resolve(root, "jobs"), directory, project };
}

const files = {
  "output/output/0612_線路方向基礎.pdf": "%PDF 0612",
  "output/export/0612_線路方向基礎.xlsx": "PK 0612",
  "output/post/線路方向.pik": "PIK",
  "output/post/線路方向.pik.provenance.json": "{}",
  "output/post/線路方向_JRSNAP/a.DB1": "DB1",
  "output/post/線路方向_JRSNAP/a.ndt": "NDT",
};

test("places a WebPier job's artifacts into output/, export/ and post/, a JRSNAP folder whole", async () => {
  const { root, jobRoot, project } = await job(files);
  try {
    const placed = await place({ jobRoot, jobId, project });
    assert.deepEqual(placed.replacedFolders, ["post/線路方向_JRSNAP"]);
    assert.equal(await readFile(resolve(project, "output/0612_線路方向基礎.pdf"), "utf8"), "%PDF 0612");
    assert.equal(await readFile(resolve(project, "export/0612_線路方向基礎.xlsx"), "utf8"), "PK 0612");
    assert.deepEqual((await readdir(resolve(project, "post/線路方向_JRSNAP"))).sort(), ["a.DB1", "a.ndt"]);
    assert.deepEqual((await readdir(resolve(project, "post"))).sort(), ["線路方向.pik", "線路方向.pik.provenance.json", "線路方向_JRSNAP"]);

    // An existing destination stops everything without --overwrite.
    await writeFile(resolve(project, "post/線路方向_JRSNAP/old.LOG"), "old");
    await writeFile(resolve(project, "post/kept.csv"), "kept");
    await assert.rejects(place({ jobRoot, jobId, project }), /--overwrite/);
    // With it, the folder is replaced whole and files the job does not publish elsewhere are kept.
    const again = await place({ jobRoot, jobId, project, overwrite: true });
    assert.equal(again.overwritten.length, 5);
    assert.deepEqual((await readdir(resolve(project, "post/線路方向_JRSNAP"))).sort(), ["a.DB1", "a.ndt"]);
    assert.equal(await readFile(resolve(project, "post/kept.csv"), "utf8"), "kept");
    assert.deepEqual((await readdir(resolve(project, "post"))).filter((name) => name.startsWith(".")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("checks the whole job against its manifest before writing anything", async () => {
  const { root, jobRoot, directory, project } = await job(files);
  try {
    assert.deepEqual((await place({ jobRoot, jobId, project, dryRun: true })).files.length, 6);
    assert.deepEqual(await readdir(project), []);
    await writeFile(resolve(directory, "output/post/線路方向_JRSNAP/a.ndt"), "CHANGED");
    await assert.rejects(place({ jobRoot, jobId, project }), /manifest と一致しません/);
    assert.deepEqual(await readdir(project), []);
    await assert.rejects(place({ jobRoot, jobId: "../x", project }), /jobId が不正です/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("places only successful webpier_generate jobs with plain paths", async () => {
  for (const [changes, pattern] of [
    [{ tool: "aggrese_calculate" }, /webpier_generate の job ではありません/],
    [{ ok: false, executionStatus: "failed" }, /失敗した生成/],
  ] as const) {
    const { root, jobRoot, project } = await job(files, changes);
    try { await assert.rejects(place({ jobRoot, jobId, project }), pattern); } finally { await rm(root, { recursive: true, force: true }); }
  }
  for (const [bad, pattern] of [
    [{ "output/result.json": "{}" }, /output\/・export\/・post\/ のどれでもない/],
    [{ "output/export/sub/x.xlsx": "x" }, /深すぎます/],
    [{ "output/output/sub/x.pdf": "x" }, /深すぎます/],
  ] as const) {
    const { root, jobRoot, project } = await job(bad);
    try { await assert.rejects(place({ jobRoot, jobId, project }), pattern); } finally { await rm(root, { recursive: true, force: true }); }
  }
});
