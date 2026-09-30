import { access, mkdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  capacitaRunner: string | null;
  soilStructureRunner: string | null;
  runnerConfigurations: {
    capacita: RunnerConfiguration;
    soilStructure: RunnerConfiguration;
  };
  jobRoot: string;
  allowedInputRoots: string[];
  allowedOutputRoots: string[];
  steelDanEnabled: boolean;
  timeoutMs: number;
  maxInputBytes: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxArtifactBytes: number;
  maxTextReadBytes: number;
}

export interface RunnerConfiguration {
  environmentVariable: string;
  configuredPath: string;
  resolvedPath: string | null;
  source: "environment" | "default";
}

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const documentsRoot = resolve(homedir(), "Documents");

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function booleanValue(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`${name} must be true or false`);
}

function absolutePath(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return resolve(value);
}

async function runnerConfiguration(name: string, fallback: string): Promise<RunnerConfiguration> {
  const configuredPath = absolutePath(name, fallback);
  try {
    await access(configuredPath, constants.R_OK);
    return {
      environmentVariable: name,
      configuredPath,
      resolvedPath: await realpath(configuredPath),
      source: process.env[name] === undefined ? "default" : "environment",
    };
  } catch {
    return {
      environmentVariable: name,
      configuredPath,
      resolvedPath: null,
      source: process.env[name] === undefined ? "default" : "environment",
    };
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const capacitaConfiguration = await runnerConfiguration(
    "STRUCTURAL_MCP_WEBDAN_RUNNER",
    resolve(sourceRoot, "Capacita/WebDanforCS/Headless/bin/Release/net8.0/WebDanforCS.Headless.dll"),
  );
  const soilStructureConfiguration = await runnerConfiguration(
    "STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER",
    resolve(sourceRoot, "SoilStructure/SoilStructure/Headless/bin/Release/net10.0/SoilStructure.Headless.exe"),
  );
  const defaultJobs = process.env.LOCALAPPDATA
    ? resolve(process.env.LOCALAPPDATA, "structural-mcp/jobs")
    : resolve(sourceRoot, ".structural-mcp/jobs");
  const jobRoot = absolutePath("STRUCTURAL_MCP_JOB_ROOT", defaultJobs);
  const configuredInputRoots = process.env.STRUCTURAL_MCP_ALLOWED_ROOTS?.split(delimiter).filter(Boolean) ?? [documentsRoot];
  const configuredOutputRoots = process.env.STRUCTURAL_MCP_ALLOWED_OUTPUT_ROOTS?.split(delimiter).filter(Boolean) ?? [documentsRoot];
  const allowedInputRoots = configuredInputRoots.map((root) => {
    if (!isAbsolute(root)) throw new Error("STRUCTURAL_MCP_ALLOWED_ROOTS must contain absolute paths");
    return resolve(root);
  });
  const allowedOutputRoots = configuredOutputRoots.map((root) => {
    if (!isAbsolute(root)) throw new Error("STRUCTURAL_MCP_ALLOWED_OUTPUT_ROOTS must contain absolute paths");
    return resolve(root);
  });

  await mkdir(jobRoot, { recursive: true });
  return {
    capacitaRunner: capacitaConfiguration.resolvedPath,
    soilStructureRunner: soilStructureConfiguration.resolvedPath,
    runnerConfigurations: {
      capacita: capacitaConfiguration,
      soilStructure: soilStructureConfiguration,
    },
    jobRoot: await realpath(jobRoot),
    allowedInputRoots: await Promise.all(allowedInputRoots.map((root) => realpath(root))),
    allowedOutputRoots: await Promise.all(allowedOutputRoots.map((root) => realpath(root))),
    steelDanEnabled: booleanValue("STRUCTURAL_MCP_ENABLE_STEELDAN", false),
    timeoutMs: positiveInteger("STRUCTURAL_MCP_TIMEOUT_MS", 180_000),
    maxInputBytes: positiveInteger("STRUCTURAL_MCP_MAX_INPUT_BYTES", 16 * 1024 * 1024),
    maxStdoutBytes: positiveInteger("STRUCTURAL_MCP_MAX_STDOUT_BYTES", 1024 * 1024),
    maxStderrBytes: positiveInteger("STRUCTURAL_MCP_MAX_STDERR_BYTES", 4 * 1024 * 1024),
    maxArtifactBytes: positiveInteger("STRUCTURAL_MCP_MAX_ARTIFACT_BYTES", 128 * 1024 * 1024),
    maxTextReadBytes: positiveInteger("STRUCTURAL_MCP_MAX_TEXT_READ_BYTES", 256 * 1024),
  };
}
