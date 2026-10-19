import { spawn } from "node:child_process";
import { pythonForScript, type AppConfig } from "./config.js";
import { runnerEnvelopeSchema, type RunnerEnvelope } from "./contracts.js";

export type RunnerCommand =
  | "run-rc" | "inspect-rc" | "validate-rc" | "compose-rc" | "run-steel"
  | "validate" | "run" | "export-sdc" | "run-ground-displacement" | "inspect" | "contract" | "schema";

export type RunnerEngine = "fempython" | "webdan2" | "steeldan" | "soilstructure" | "aggrese" | "webpier";

export interface RunOptions {
  /** Added to the minimal environment: WebPier receives the paths of the runners it calls. */
  environment?: Readonly<Record<string, string>> | undefined;
  /** Replaces STRUCTURAL_MCP_TIMEOUT_MS for this call. */
  timeoutMs?: number | undefined;
}

/** How a runner is started: .dll with dotnet, .mjs/.js/.cjs with node, .py with the .venv beside it, else directly. */
export function runnerInvocation(runnerPath: string, runnerArgs: readonly string[]): { executable: string; args: string[] } {
  const lower = runnerPath.toLowerCase();
  if (lower.endsWith(".dll")) return { executable: "dotnet", args: [runnerPath, ...runnerArgs] };
  if (/\.(?:cjs|mjs|js)$/.test(lower)) return { executable: process.execPath, args: [runnerPath, ...runnerArgs] };
  if (lower.endsWith(".py")) return { executable: pythonForScript(runnerPath), args: ["-X", "utf8", runnerPath, ...runnerArgs] };
  return { executable: runnerPath, args: [...runnerArgs] };
}

export async function runEngine(
  runnerPath: string,
  command: RunnerCommand,
  expectedEngine: RunnerEngine,
  inputPath: string | null,
  outputDirectory: string | null,
  runnerOptions: readonly string[],
  config: AppConfig,
  options: RunOptions = {},
): Promise<RunnerEnvelope> {
  const runnerArgs = [
    command,
    ...(inputPath === null ? [] : ["--input", inputPath]),
    ...(outputDirectory === null ? [] : ["--output-dir", outputDirectory]),
    ...runnerOptions,
  ];
  const { executable, args } = runnerInvocation(runnerPath, runnerArgs);
  const child = spawn(executable, args, {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      DOTNET_ROOT: process.env.DOTNET_ROOT,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      ...options.environment,
    },
  });

  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let outputError: Error | undefined;
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = Buffer.concat([stdout, chunk]);
    if (stdout.length > config.maxStdoutBytes) {
      outputError = new Error("runner stdout exceeded the configured size limit");
      child.kill();
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = Buffer.concat([stderr, chunk]);
    if (stderr.length > config.maxStderrBytes) {
      outputError = new Error("runner stderr exceeded the configured size limit");
      child.kill();
    }
  });

  const timer = setTimeout(() => {
    outputError = new Error("runner timed out");
    child.kill();
  }, options.timeoutMs ?? config.timeoutMs);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));
  if (outputError) throw outputError;

  let decoded: unknown;
  try {
    decoded = JSON.parse(stdout.toString("utf8"));
  } catch {
    throw new Error(`runner returned invalid JSON (exit ${exit.code ?? exit.signal ?? "unknown"})`);
  }
  const parsed = runnerEnvelopeSchema.safeParse(decoded);
  if (!parsed.success) throw new Error(`runner response violated protocol v1: ${parsed.error.message}`);
  if (parsed.data.engine !== expectedEngine) {
    throw new Error("runner returned an unexpected engine name");
  }
  if (exit.code === 0 && !parsed.data.ok) throw new Error("runner exit code and response disagree");
  if (exit.code !== 0 && parsed.data.ok) throw new Error("runner exit code and response disagree");
  return parsed.data;
}
