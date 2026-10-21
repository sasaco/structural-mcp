// Place the artifacts of a webpier_generate job into a project's output/, export/ and post/ folders.
//
//   node place-webpier-outputs.mjs --job-root <jobRoot> --job-id <jobId> --project <project folder> [--overwrite] [--dry-run]
//
// jobRoot is get_capabilities' pathPolicy.jobRoot and jobId is webpier_generate's jobId (the MCP server runs on the
// same PC). Every artifact the job's manifest.json lists is read from the job and checked against the manifest's
// byte count and SHA-256 before anything is written. output/output/<file> goes to <project>/output/<file>,
// output/export/<file> (the grid Excel workbooks) to <project>/export/<file> and output/post/<file> to
// <project>/post/<file>; the files of a JRSNAP result folder (post/<folder>/<file>) replace
// that folder whole, as WebPier's CLI does. Without --overwrite nothing is written when a destination exists.
// Files of earlier generations that this job does not publish are left as they are (the CLI does the same).
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const JOB_ID = /^(\d{4}-\d{2}-\d{2})_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ARTIFACT = /^output\/(output|export|post)\/(.+)$/;
const DIRECTORIES = ["output", "export", "post"];

async function kind(path) {
  try {
    const info = await lstat(path);
    return info.isSymbolicLink() ? "link" : info.isDirectory() ? "folder" : info.isFile() ? "file" : "other";
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function plainParts(text) {
  const parts = text.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || /[\\:]/.test(part))) {
    throw new Error(`成果物のパスが不正です: ${text}`);
  }
  return parts;
}

/** Read and check every artifact of the job; nothing is written. */
export async function readJob(jobRoot, jobId) {
  const match = JOB_ID.exec(jobId);
  if (!match) throw new Error(`jobId が不正です: ${jobId}`);
  const jobDirectory = resolve(jobRoot, match[1], jobId);
  const manifest = JSON.parse(await readFile(resolve(jobDirectory, "manifest.json"), "utf8"));
  if (manifest.jobId !== jobId || manifest.tool !== "webpier_generate") {
    throw new Error(`webpier_generate の job ではありません: ${jobId}（${manifest.tool}）`);
  }
  if (manifest.ok !== true || manifest.executionStatus !== "success") {
    throw new Error(`失敗した生成の成果物は置きません: ${jobId}（${manifest.executionStatus}）`);
  }
  const files = [];
  for (const artifact of manifest.artifacts) {
    const found = ARTIFACT.exec(artifact.relativePath);
    if (!found) throw new Error(`output/・export/・post/ のどれでもない成果物です: ${artifact.relativePath}`);
    const [directory, parts] = [found[1], plainParts(found[2])];
    if (parts.length > (directory === "post" ? 2 : 1)) throw new Error(`成果物のパスが深すぎます: ${artifact.relativePath}`);
    const data = await readFile(resolve(jobDirectory, ...artifact.relativePath.split("/")));
    if (data.length !== artifact.bytes || createHash("sha256").update(data).digest("hex") !== artifact.sha256) {
      throw new Error(`成果物が manifest と一致しません: ${artifact.relativePath}`);
    }
    files.push({ directory, parts, data });
  }
  return { manifest, files };
}

/** Check, then place the job's artifacts into project/output, project/export and project/post. */
export async function place({ jobRoot, jobId, project, overwrite = false, dryRun = false }) {
  const { manifest, files } = await readJob(jobRoot, jobId);
  const root = resolve(project);
  if (await kind(root) !== "folder") throw new Error(`案件のフォルダーがありません: ${root}`);
  const folders = [...new Set(files.filter((file) => file.parts.length === 2).map((file) => file.parts[0]))];
  const single = files.filter((file) => file.parts.length === 1);
  const destinations = [
    ...single.map((file) => ({ path: resolve(root, file.directory, file.parts[0]), want: "file" })),
    ...folders.map((name) => ({ path: resolve(root, "post", name), want: "folder" })),
  ];
  const existing = [];
  for (const destination of destinations) {
    const found = await kind(destination.path);
    if (found === null) continue;
    if (found !== destination.want) throw new Error(`置き換えられない ${found} があります: ${destination.path}`);
    existing.push(destination.path);
  }
  if (existing.length > 0 && !overwrite) {
    throw new Error(`既にあるので置きません（置き換えるなら --overwrite）: ${existing.slice(0, 5).join("、")}${existing.length > 5 ? ` ほか${existing.length - 5}件` : ""}`);
  }
  const summary = {
    jobId, project: root, engineeringStatus: manifest.engineeringStatus,
    files: files.map((file) => `${file.directory}/${file.parts.join("/")}`), replacedFolders: folders.map((name) => `post/${name}`),
    overwritten: existing, dryRun,
  };
  if (dryRun) return summary;
  const suffix = () => randomBytes(4).toString("hex");
  for (const directory of DIRECTORIES.filter((name) => files.some((file) => file.directory === name))) {
    await mkdir(resolve(root, directory), { recursive: true });
  }
  for (const file of single) {
    const destination = resolve(root, file.directory, file.parts[0]);
    const staged = resolve(root, file.directory, `.${file.parts[0]}.placing-${suffix()}`);
    await writeFile(staged, file.data, { flag: "wx" });
    await rename(staged, destination);
  }
  for (const name of folders) {
    const destination = resolve(root, "post", name);
    const staged = resolve(root, "post", `.${name}.placing-${suffix()}`);
    await mkdir(staged);
    for (const file of files.filter((item) => item.parts.length === 2 && item.parts[0] === name)) {
      await writeFile(resolve(staged, file.parts[1]), file.data, { flag: "wx" });
    }
    if (await kind(destination) !== null) {
      const old = resolve(root, "post", `.${name}.old-${suffix()}`);
      await rename(destination, old);
      await rename(staged, destination);
      await rm(old, { recursive: true, force: true });
    } else {
      await rename(staged, destination);
    }
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    "job-root": { type: "string" }, "job-id": { type: "string" }, project: { type: "string" },
    overwrite: { type: "boolean", default: false }, "dry-run": { type: "boolean", default: false },
  } });
  if (!values["job-root"] || !values["job-id"] || !values.project) {
    console.error("usage: node place-webpier-outputs.mjs --job-root <jobRoot> --job-id <jobId> --project <folder> [--overwrite] [--dry-run]");
    process.exit(2);
  }
  try {
    const summary = await place({ jobRoot: values["job-root"], jobId: values["job-id"], project: values.project,
      overwrite: values.overwrite, dryRun: values["dry-run"] });
    process.stdout.write(`${JSON.stringify({ ok: true, ...summary }, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exit(1);
  }
}
