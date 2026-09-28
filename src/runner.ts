import { spawn } from "node:child_process";
import type { AppConfig } from "./config.js";
import { runnerEnvelopeSchema, type RunnerEnvelope } from "./contracts.js";

export async function runEngine(
  runnerPath: string,
  command: "run-rc" | "run-steel" | "run",
  expectedEngine: "webdan2" | "steeldan" | "soilstructure",
  inputPath: string,
  outputDirectory: string,
  optionName: "--output-format" | "--generate-pdf",
  optionValue: string,
  config: AppConfig,
): Promise<RunnerEnvelope> {
  const runnerArgs = [command, "--input", inputPath, "--output-dir", outputDirectory, optionName, optionValue];
  const isDll = runnerPath.toLowerCase().endsWith(".dll");
  const isNodeScript = /\.(?:cjs|mjs|js)$/i.test(runnerPath);
  const executable = isDll ? "dotnet" : isNodeScript ? process.execPath : runnerPath;
  const args = isDll || isNodeScript ? [runnerPath, ...runnerArgs] : runnerArgs;
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
  }, config.timeoutMs);
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
