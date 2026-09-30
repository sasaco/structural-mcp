import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
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
  extension: ".wdj" | ".wsj" | ".json" | ".soilstructure.json",
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

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
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

export async function materializeArtifact(
  jobId: string,
  artifactId: string,
  destinationPath: string,
  overwrite: boolean,
  config: AppConfig,
): Promise<{ destinationPath: string; bytes: number; sha256: string; overwritten: boolean }> {
  if (!isAbsolute(destinationPath)) throw new Error("destinationPath must be an absolute path");
  const destination = resolve(destinationPath);
  const destinationParent = await realpath(dirname(destination));
  if (!config.allowedOutputRoots.some((root) => isInside(root, destinationParent))) {
    throw new Error("destination path is outside STRUCTURAL_MCP_ALLOWED_OUTPUT_ROOTS");
  }

  const manifest = await loadManifest(jobId, config);
  const artifact = manifest.artifacts.find((item) => item.artifactId === artifactId);
  if (!artifact) throw new Error("artifactId was not found in this job");
  const jobRoot = await realpath(jobDirectory(jobId, config));
  const source = await realpath(resolve(jobRoot, artifact.relativePath));
  if (!isInside(jobRoot, source)) throw new Error("artifact path escaped the job directory");
  const sourceInfo = await stat(source);
  if (!sourceInfo.isFile() || sourceInfo.size !== artifact.bytes || await sha256(source) !== artifact.sha256) {
    throw new Error("artifact no longer matches its manifest");
  }

  const destinationExisted = await exists(destination);
  if (destinationExisted && !(await stat(destination)).isFile()) {
    throw new Error("destination exists and is not a file");
  }
  if (destinationExisted && !overwrite) throw new Error("destination already exists; set overwrite=true to replace it");
  const temporary = resolve(destinationParent, `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    const temporaryInfo = await stat(temporary);
    if (temporaryInfo.size !== artifact.bytes || await sha256(temporary) !== artifact.sha256) {
      throw new Error("staged artifact verification failed");
    }
    if (!overwrite && await exists(destination)) {
      throw new Error("destination was created while the artifact was being staged");
    }
    await rename(temporary, destination);
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  return { destinationPath: destination, bytes: artifact.bytes, sha256: artifact.sha256, overwritten: destinationExisted };
}
