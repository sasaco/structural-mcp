import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AppConfig } from "./config.js";
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

export async function createJob(
  tool: JobManifest["tool"],
  input: string,
  extension: ".wdj" | ".wsj" | ".soilstructure.json",
  config: AppConfig,
): Promise<{ jobId: string; directory: string; inputPath: string; outputDirectory: string }> {
  if (Buffer.byteLength(input, "utf8") > config.maxInputBytes) throw new Error("input exceeds the configured size limit");
  const date = new Date().toISOString().slice(0, 10);
  const jobId = `${date}_${randomUUID()}`;
  const directory = resolve(config.jobRoot, date, jobId);
  const inputDirectory = resolve(directory, "input");
  const outputDirectory = resolve(directory, "output");
  await mkdir(inputDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const inputPath = resolve(inputDirectory, `model${extension}`);
  await writeFile(inputPath, input, { encoding: "utf8", flag: "wx" });
  return { jobId, directory, inputPath, outputDirectory };
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
    let artifactId = artifact.kind.replace(/[^a-zA-Z0-9_-]/g, "-") || "artifact";
    for (let suffix = 2; used.has(artifactId); suffix += 1) artifactId = `${artifact.kind}-${suffix}`;
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
