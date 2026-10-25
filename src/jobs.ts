import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { runnerEnvelopeSchema } from "./contracts.js";
import type { ArtifactRecord, JobManifest, RunnerEnvelope } from "./contracts.js";

const jobIdPattern = /^(\d{4}-\d{2}-\d{2})_([0-9a-f-]{36})$/;

function isInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

export async function resolveInputPath(inputPath: string, config: AppConfig): Promise<string> {
  const resolved = await realpath(resolve(inputPath));
  if (!config.allowedInputRoots.some((root) => isInside(root, resolved))) {
    throw new Error("input path is outside STRUCTURAL_MCP_ALLOWED_ROOTS");
  }
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("input path is not a file");
  if (info.size > config.maxInputBytes) throw new Error("input exceeds the configured size limit");
  return resolved;
}

/** A WebPier load model's add-in folder (decision 70): a directory inside STRUCTURAL_MCP_ALLOWED_ROOTS, by its real path. */
export async function resolveAddinFolder(folder: string, config: AppConfig): Promise<string> {
  const resolved = await realpath(resolve(folder));
  if (!config.allowedInputRoots.some((root) => isInside(root, resolved))) {
    throw new Error("addin folder is outside STRUCTURAL_MCP_ALLOWED_ROOTS");
  }
  if (!(await stat(resolved)).isDirectory()) throw new Error("addin is not a folder");
  return resolved;
}

export interface PreparedJob {
  jobId: string;
  directory: string;
  inputPath: string;
  outputDirectory: string;
  /** Job-specific runner options, appended after the tool's options. */
  runnerOptions?: readonly string[];
}

async function allocateJob(config: AppConfig): Promise<{ jobId: string; directory: string; inputDirectory: string; outputDirectory: string }> {
  const date = new Date().toISOString().slice(0, 10);
  const jobId = `${date}_${randomUUID()}`;
  const directory = resolve(config.jobRoot, date, jobId);
  const inputDirectory = resolve(directory, "input");
  const outputDirectory = resolve(directory, "output");
  await mkdir(inputDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  return { jobId, directory, inputDirectory, outputDirectory };
}

export async function createJob(
  tool: JobManifest["tool"],
  input: string,
  extension: ".wdj" | ".wsj" | ".json" | ".soilstructure.json",
  config: AppConfig,
): Promise<PreparedJob> {
  if (Buffer.byteLength(input, "utf8") > config.maxInputBytes) throw new Error("input exceeds the configured size limit");
  const { jobId, directory, inputDirectory, outputDirectory } = await allocateJob(config);
  const inputPath = resolve(inputDirectory, `model${extension}`);
  await writeFile(inputPath, input, { encoding: "utf8", flag: "wx" });
  return { jobId, directory, inputPath, outputDirectory };
}

/**
 * Copy a JSON input into a job byte for byte under its own file name (inline input: `inlineName`), for an engine
 * that records the input's name and SHA-256 in its outputs (WebPier's provenance), so they match the client's file.
 */
export async function createNamedJsonJob(
  inputPath: string | undefined,
  input: string | undefined,
  inlineName: string,
  config: AppConfig,
): Promise<PreparedJob> {
  if ((inputPath === undefined) === (input === undefined)) {
    throw new Error("inputPathまたはinputのどちらか一方だけを指定してください。");
  }
  let bytes: Buffer;
  let name = inlineName;
  if (inputPath !== undefined) {
    const resolved = await resolveInputPath(inputPath, config);
    if (extname(resolved).toLowerCase() !== ".json") throw new Error("入力ファイルの拡張子は.jsonである必要があります。");
    bytes = await readFile(resolved);
    name = basename(resolved);
  } else {
    bytes = Buffer.from(input!, "utf8");
    if (bytes.length > config.maxInputBytes) throw new Error("inputがサイズ上限を超えています。");
  }
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8").replace(/^﻿/, ""));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("root value must be an object");
  } catch (error) {
    throw new Error(`入力は有効なJSON objectではありません: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { jobId, directory, inputDirectory, outputDirectory } = await allocateJob(config);
  const jobInput = resolve(inputDirectory, name);
  await writeFile(jobInput, bytes, { flag: "wx" });
  return { jobId, directory, inputPath: jobInput, outputDirectory };
}

const xmlEntities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, entity: string) =>
    entity.startsWith("#x") ? String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
      : entity.startsWith("#") ? String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
        : xmlEntities[entity]!);
}

/** SNAP/SnapDBPath entries of an Aggre-SE (Batch) project XML, by case index; empty entries are "". */
export function aggreSeSnapPaths(xml: string): string[] {
  const block = /<SnapDBPath>([\s\S]*?)<\/SnapDBPath>/.exec(xml)?.[1];
  if (block === undefined) return [];
  return [...block.matchAll(/<string(?:\s[^>]*?\/>|\s*\/>|>([\s\S]*?)<\/string>)/g)]
    .map((match) => decodeXmlText(match[1] ?? "").trim());
}

async function allowedFile(path: string, config: AppConfig): Promise<{ path: string; bytes: number }> {
  const resolved = await realpath(path);
  if (!config.allowedInputRoots.some((root) => isInside(root, resolved))) {
    throw new Error(`${basename(path)} is outside STRUCTURAL_MCP_ALLOWED_ROOTS`);
  }
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`${basename(path)} is not a file`);
  return { path: resolved, bytes: info.size };
}

/** SOIL-JR's 基礎照査連携用データ (.sdr) a pile foundation takes its limit values from, for the direction of the project. */
export interface AggreSeSdr {
  path: string;
  direction: "axial" | "transverse";
  /** The .sdr for the liquefaction (杭基礎(液状化時用).sdr), for a project with a liquefaction Case. */
  liquefiedPath?: string;
}

/**
 * Copy an Aggre-SE project into a job: the XML unchanged, and for each case every JRSNAP file sharing
 * the DB1 name (SNAPDBLib unpacks *.R10 etc. from them), the direct-foundation CSV and Aspect-SE CSVs.
 * Files Batch itself writes beside a DB1 (*.xlsx / *.csv with the DB1 name) are left out. The .sdr, when given, is
 * copied to input/sdr/ and handed to the runner with its direction.
 */
export async function createAggreSeJob(
  inputPath: string,
  spectralDuctility: readonly { caseNumber: number; value: number }[],
  config: AppConfig,
  sdr?: AggreSeSdr,
): Promise<PreparedJob> {
  const xml = await resolveInputPath(inputPath, config);
  if (extname(xml).toLowerCase() !== ".xml") throw new Error("入力ファイルの拡張子は.xmlである必要があります。");
  const bytes = await readFile(xml);
  const entries = aggreSeSnapPaths(new TextDecoder("shift_jis").decode(bytes));
  if (entries.length > 999) throw new Error("SNAP/SnapDBPath has too many cases");

  const sources = new Map<number, { db1: string; files: string[] }>();
  let total = bytes.length;
  for (const [index, entry] of entries.entries()) {
    if (entry === "") continue;
    const candidate = win32.isAbsolute(entry) ? entry : resolve(dirname(xml), entry);
    let db1: string;
    try {
      ({ path: db1 } = await allowedFile(candidate, config));
    } catch (error) {
      throw new Error(`ケース${index + 1}のDB1を読み取れません（${entry}）: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (extname(db1).toLowerCase() !== ".db1") throw new Error(`ケース${index + 1}のSnapDBPathがDB1ではありません: ${entry}`);
    const folder = dirname(db1);
    const stem = basename(db1, extname(db1)).toLowerCase();
    const files: string[] = [];
    for (const name of await readdir(folder)) {
      const lower = name.toLowerCase();
      const sibling = lower.startsWith(`${stem}.`) && ![".xlsx", ".csv"].includes(extname(lower));
      if (!sibling && lower !== `${stem}_output_chokukiso.csv` && !/^aspect-se_.*\.csv$/.test(lower)) continue;
      const file = await allowedFile(resolve(folder, name), config);
      total += file.bytes;
      if (total > config.maxBundleBytes) throw new Error("入力XMLとJRSNAP結果の合計がSTRUCTURAL_MCP_MAX_BUNDLE_BYTESを超えています。");
      files.push(file.path);
    }
    sources.set(index, { db1, files });
  }
  let sdrSource: string | undefined;
  let liquefiedSource: string | undefined;
  for (const [name, given] of [["sdrPath", sdr?.path], ["sdrLiquefiedPath", sdr?.liquefiedPath]] as const) {
    if (given === undefined) continue;
    if (!win32.isAbsolute(given)) throw new Error(`${name}は絶対パスで指定してください。`);
    if (extname(given).toLowerCase() !== ".sdr") throw new Error(`${name}の拡張子は.sdrである必要があります。`);
    const file = await allowedFile(given, config);
    total += file.bytes;
    if (total > config.maxBundleBytes) throw new Error("入力XMLとJRSNAP結果の合計がSTRUCTURAL_MCP_MAX_BUNDLE_BYTESを超えています。");
    if (name === "sdrPath") sdrSource = file.path;
    else liquefiedSource = file.path;
  }
  const known = new Set([...sources.keys()].map((index) => index + 1));
  for (const { caseNumber } of spectralDuctility) {
    if (!known.has(caseNumber)) throw new Error(`spectralDuctilityのケース${caseNumber}にはDB1がありません。`);
  }

  const job = await allocateJob(config);
  const modelPath = resolve(job.inputDirectory, "model.xml");
  await writeFile(modelPath, bytes, { flag: "wx" });
  const snapMap: Record<string, string> = {};
  for (const [index, { db1, files }] of sources) {
    const target = resolve(job.inputDirectory, "snap", String(index + 1).padStart(2, "0"));
    await mkdir(target, { recursive: true });
    for (const file of files) await copyFile(file, resolve(target, basename(file)), constants.COPYFILE_EXCL);
    snapMap[String(index)] = resolve(target, basename(db1));
  }
  const snapMapPath = resolve(job.inputDirectory, "snap-map.json");
  await writeFile(snapMapPath, JSON.stringify(snapMap), { encoding: "utf8", flag: "wx" });
  const runnerOptions = ["--snap-map", snapMapPath];
  if (sdr !== undefined && sdrSource !== undefined) {
    const target = resolve(job.inputDirectory, "sdr");
    await mkdir(target, { recursive: true });
    const copy = resolve(target, basename(sdrSource));
    await copyFile(sdrSource, copy, constants.COPYFILE_EXCL);
    runnerOptions.push("--sdr", copy, "--sdr-direction", sdr.direction);
    if (liquefiedSource !== undefined) {
      const liquefiedCopy = resolve(target, basename(liquefiedSource));
      await copyFile(liquefiedSource, liquefiedCopy, constants.COPYFILE_EXCL);
      runnerOptions.push("--sdr-liquefied", liquefiedCopy);
    }
  }
  if (spectralDuctility.length > 0) {
    const ductilityPath = resolve(job.inputDirectory, "spectral-ductility.json");
    const values = Object.fromEntries(spectralDuctility.map(({ caseNumber, value }) => [String(caseNumber - 1), value]));
    await writeFile(ductilityPath, JSON.stringify(values), { encoding: "utf8", flag: "wx" });
    runnerOptions.push("--spectral-ductility", ductilityPath);
  }
  return { jobId: job.jobId, directory: job.directory, inputPath: modelPath, outputDirectory: job.outputDirectory, runnerOptions };
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function verifyArtifacts(
  outputDirectory: string,
  envelope: RunnerEnvelope,
  config: AppConfig,
): Promise<ArtifactRecord[]> {
  const outputRoot = await realpath(outputDirectory);
  const result: ArtifactRecord[] = [];
  const used = new Set<string>();
  for (const artifact of envelope.artifacts) {
    if (isAbsolute(artifact.relativePath)) throw new Error("runner returned an absolute artifact path");
    const candidate = await realpath(resolve(outputRoot, artifact.relativePath));
    if (!isInside(outputRoot, candidate)) throw new Error("runner artifact escaped the output directory");
    const info = await stat(candidate);
    if (!info.isFile() || info.size !== artifact.bytes) throw new Error("runner artifact size mismatch");
    if (info.size > config.maxArtifactBytes) throw new Error("runner artifact exceeds the configured size limit");
    if ((await sha256(candidate)) !== artifact.sha256) throw new Error("runner artifact hash mismatch");
    const baseId = artifact.kind.replace(/[^a-zA-Z0-9_-]/g, "-") || "artifact";
    let artifactId = baseId;
    for (let suffix = 2; used.has(artifactId); suffix += 1) artifactId = `${baseId}-${suffix}`;
    used.add(artifactId);
    result.push({
      artifactId,
      name: basename(candidate),
      mediaType: artifact.mediaType,
      relativePath: `output/${artifact.relativePath.replaceAll("\\", "/")}`,
      bytes: info.size,
      sha256: artifact.sha256,
    });
  }
  return result;
}

export async function saveManifest(directory: string, manifest: JobManifest): Promise<void> {
  await writeFile(resolve(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export function jobDirectory(jobId: string, config: AppConfig): string {
  const match = jobIdPattern.exec(jobId);
  if (!match?.[1]) throw new Error("invalid jobId");
  return resolve(config.jobRoot, match[1], jobId);
}

export async function loadManifest(jobId: string, config: AppConfig): Promise<JobManifest> {
  const directory = jobDirectory(jobId, config);
  const manifestPath = await realpath(resolve(directory, "manifest.json"));
  if (!isInside(config.jobRoot, manifestPath)) throw new Error("job path escaped the job root");
  return JSON.parse(await readFile(manifestPath, "utf8")) as JobManifest;
}

const storedManifestSchema = runnerEnvelopeSchema.omit({ protocolVersion: true, artifacts: true }).extend({
  schemaVersion: z.literal(1),
  jobId: z.string(),
  tool: z.string().min(1),
  createdAt: z.string(),
  completedAt: z.string(),
  artifacts: z.array(z.object({
    artifactId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    name: z.string().min(1),
    mediaType: z.string().min(1),
    relativePath: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })),
});

/** Return exact artifact bytes; clients decode base64 and save them on their own filesystem. */
export async function readArtifact(
  jobId: string,
  artifactId: string,
  offsetBytes: number,
  maxBytes: number,
  config: AppConfig,
): Promise<{ base64: string; offsetBytes: number; nextOffsetBytes: number; eof: boolean; totalBytes: number }> {
  if (!Number.isSafeInteger(offsetBytes) || offsetBytes < 0) {
    throw new Error("offsetBytes must be a nonnegative safe integer");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive safe integer");
  }
  if (typeof artifactId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(artifactId)) {
    throw new Error("invalid artifactId");
  }
  if (!Number.isSafeInteger(config.maxTextReadBytes) || config.maxTextReadBytes <= 0 ||
      !Number.isSafeInteger(config.maxArtifactBytes) || config.maxArtifactBytes <= 0) {
    throw new Error("artifact read limits must be positive safe integers");
  }

  const directory = await realpath(jobDirectory(jobId, config));
  const root = await realpath(config.jobRoot);
  if (!isInside(root, directory) || relative(root, directory) === "") {
    throw new Error("job path escaped the job root");
  }
  const manifestPath = await realpath(resolve(directory, "manifest.json"));
  if (!isInside(directory, manifestPath)) throw new Error("manifest path escaped the job directory");
  const parsed = storedManifestSchema.safeParse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (!parsed.success || parsed.data.jobId !== jobId) throw new Error("invalid job manifest");
  const manifest = parsed.data;
  if (new Set(manifest.artifacts.map((item) => item.artifactId)).size !== manifest.artifacts.length) {
    throw new Error("invalid job manifest: duplicate artifactId");
  }
  const artifact = manifest.artifacts.find((item) => item.artifactId === artifactId);
  if (!artifact) throw new Error("artifactId was not found in this job");
  if (isAbsolute(artifact.relativePath)) throw new Error("artifact path must be relative");
  const expectedOutput = resolve(directory, "output");
  const output = await realpath(expectedOutput);
  if (!isInside(expectedOutput, output)) throw new Error("output path escaped the output directory");
  const candidate = resolve(directory, artifact.relativePath);
  if (!isInside(expectedOutput, candidate)) throw new Error("artifact path escaped the output directory");
  const path = await realpath(candidate);
  if (!isInside(output, path) || path === manifestPath) throw new Error("artifact path escaped the output directory");

  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== artifact.bytes) throw new Error("artifact size mismatch");
    if (info.size > config.maxArtifactBytes) throw new Error("artifact exceeds the configured size limit");
    const start = Math.min(offsetBytes, info.size);
    const end = start + Math.min(maxBytes, config.maxTextReadBytes, info.size - start);
    const chunk = Buffer.alloc(end - start);
    const buffer = Buffer.alloc(64 * 1024);
    const hash = createHash("sha256");
    let position = 0;
    // Capture the returned chunk from the same bytes used for integrity verification.
    while (position < info.size) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, info.size - position), position);
      if (bytesRead === 0) throw new Error("artifact size mismatch");
      hash.update(buffer.subarray(0, bytesRead));
      const from = Math.max(start, position);
      const to = Math.min(end, position + bytesRead);
      if (to > from) buffer.copy(chunk, from - start, from - position, to - position);
      position += bytesRead;
    }
    if ((await file.stat()).size !== info.size) throw new Error("artifact size mismatch");
    if (hash.digest("hex") !== artifact.sha256) throw new Error("artifact hash mismatch");
    return { base64: chunk.toString("base64"), offsetBytes: start, nextOffsetBytes: end, eof: end === info.size, totalBytes: info.size };
  } finally {
    await file.close();
  }
}

export async function readTextArtifact(
  jobId: string,
  artifactId: string,
  offsetBytes: number,
  maxBytes: number,
  config: AppConfig,
): Promise<{ text: string; offsetBytes: number; nextOffsetBytes: number; eof: boolean }> {
  const manifest = await loadManifest(jobId, config);
  const artifact = manifest.artifacts.find((item) => item.artifactId === artifactId);
  if (!artifact) throw new Error("artifactId was not found in this job");
  const mediaType = artifact.mediaType.toLowerCase();
  const isJson = mediaType.startsWith("application/json");
  const isUtf8Text = mediaType.startsWith("text/") &&
    (!mediaType.includes("charset=") || mediaType.includes("charset=utf-8"));
  if (!isJson && !isUtf8Text) {
    throw new Error("artifact is not an UTF-8 text media type");
  }
  const limit = Math.min(maxBytes, config.maxTextReadBytes);
  const path = await realpath(resolve(jobDirectory(jobId, config), artifact.relativePath));
  const jobRoot = await realpath(jobDirectory(jobId, config));
  if (!isInside(jobRoot, path)) throw new Error("artifact path escaped the job directory");
  const bytes = await readFile(path);
  let start = Math.min(offsetBytes, bytes.length);
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
  let end = Math.min(start + limit, bytes.length);
  while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return { text: bytes.subarray(start, end).toString("utf8"), offsetBytes: start, nextOffsetBytes: end, eof: end >= bytes.length };
}
