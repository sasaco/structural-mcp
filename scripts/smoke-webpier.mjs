// A real MCP client for WebPier: validate, generate through webpier_generate, download every artifact, then run the
// CLI (run_design.py) with the same venv, input and runners and compare the two generations byte for byte.
//
// Files whose bytes are not WebPier's to fix are reported but do not fail the run: the reports with pages of other
// programs (FEMPython's load diagrams in 0610/0620, Capacita's sections in 0611/0621/0810/0820/0910 — its font subset
// names change every run —, JRSNAP's figures in 0710/0720, Aggre-SE's report as 0711/0721; ADR-0005, ADR-0008,
// decisions 50, 51, 56), Aggre-SE's workbooks, the JRSNAP result folders, and every result JSON or sidecar that
// records one of those files' SHA-256.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  stage: { type: "string", default: "all" },
  "frame-analysis": { type: "boolean", default: false },
  "nonlinear-analysis": { type: "boolean", default: false },
} });
if (positionals.length !== 1 || !isAbsolute(positionals[0])) {
  throw new Error("usage: npm run smoke:webpier -- <absolute input.json> [--stage 0612] [--frame-analysis] [--nonlinear-analysis]");
}
const inputPath = resolve(positionals[0]);
const repositoryRoot = resolve(import.meta.dirname, "..");
const scratch = resolve(repositoryRoot, ".structural-mcp");
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(resolve(scratch, "webpier-smoke-"));
const mcpOutput = resolve(root, "mcp");
const cliOutput = resolve(root, "cli");
const timeoutMs = Number(process.env.STRUCTURAL_MCP_WEBPIER_TIMEOUT_MS ?? 30 * 60_000);
const client = new Client({ name: "structural-mcp-webpier-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(repositoryRoot, "dist/src/index.js")],
  env: { ...process.env, STRUCTURAL_MCP_JOB_ROOT: resolve(root, "jobs"), STRUCTURAL_MCP_ALLOWED_ROOTS: dirname(inputPath) },
});

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs + 60_000 });
  if (result.isError || !result.structuredContent) {
    throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  }
  return result.structuredContent;
}

async function download(manifest, artifact) {
  const chunks = [];
  let offset = 0;
  while (true) {
    const value = await call("read_artifact", { jobId: manifest.jobId, artifactId: artifact.artifactId, offsetBytes: offset, maxBytes: 256 * 1024 });
    const bytes = Buffer.from(value.base64, "base64");
    if (value.offsetBytes !== offset || value.nextOffsetBytes !== offset + bytes.length || value.totalBytes !== artifact.bytes) {
      throw new Error("Artifact chunk metadata mismatch");
    }
    chunks.push(bytes);
    offset = value.nextOffsetBytes;
    if (value.eof) break;
    if (bytes.length === 0) throw new Error("Artifact read made no progress");
  }
  const contents = Buffer.concat(chunks);
  if (contents.length !== artifact.bytes || createHash("sha256").update(contents).digest("hex") !== artifact.sha256) {
    throw new Error(`Artifact integrity mismatch: ${artifact.relativePath}`);
  }
  return contents;
}

async function files(directory) {
  const found = new Map();
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else found.set(relative(directory, path).replaceAll("\\", "/"), await readFile(path));
    }
  }
  await walk(directory);
  return found;
}

// The kinds (artifact kind without the stage) whose bytes are another program's, and the reports with its pages.
const foreignKinds = new Set(["jrsnap", "xlsx"]);
const foreignReports = new Set(["0610", "0611", "0620", "0621", "0710", "0711", "0720", "0721", "0810", "0820", "0910"]);

try {
  await client.connect(transport);
  const capabilities = await call("get_capabilities");
  if (!capabilities.engines.webpier.enabled) throw new Error("Set up WebPier (uv sync) or STRUCTURAL_MCP_WEBPIER_RUNNER first");
  const selection = { stage: values.stage, frameAnalysis: values["frame-analysis"], nonlinearAnalysis: values["nonlinear-analysis"] };
  const contract = await call("webpier_get_contract");
  const chosen = contract.selections.find((item) => item.stage === selection.stage
    && (selection.stage !== "all" || (item.frameAnalysis === selection.frameAnalysis && item.nonlinearAnalysis === selection.nonlinearAnalysis)));
  if (!chosen?.available) throw new Error(`The runners for this selection are missing: ${JSON.stringify(chosen?.missingRunners)}`);
  await call("webpier_validate", { inputPath, ...selection });
  const started = Date.now();
  const manifest = await call("webpier_generate", { inputPath, ...selection });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (!manifest.ok || manifest.engine !== "webpier" || manifest.executionStatus !== "success") throw new Error("Unexpected generation status");
  const kinds = new Map();
  for (const artifact of manifest.artifacts) {
    const path = artifact.relativePath.replace(/^output\//, "");
    kinds.set(path, artifact.artifactId.replace(/-\d+$/, ""));
    await mkdir(dirname(resolve(mcpOutput, path)), { recursive: true });
    await writeFile(resolve(mcpOutput, path), await download(manifest, artifact), { flag: "wx" });
  }

  // The CLI with the venv, the input and the runners the server used.
  const template = await call("get_environment_template", { engine: "all" });
  const runners = Object.fromEntries(template.variables
    .filter((item) => item.readable && ["fempython", "capacita", "aggrese", "jrsnap"].includes(item.engine))
    .map((item) => [item.name, item.engine === "capacita" ? item.value.replace(/\.dll$/i, ".exe") : item.value]));
  const webPier = template.variables.find((item) => item.engine === "webpier").value;
  const python = resolve(dirname(webPier), ".venv", "Scripts", "python.exe");
  const cli = spawnSync(python, ["-X", "utf8", resolve(dirname(webPier), "run_design.py"), "--input", inputPath,
    "--output-dir", resolve(cliOutput, "output"), "--post-dir", resolve(cliOutput, "post"), "--stage", selection.stage,
    ...(selection.frameAnalysis ? ["--frame-analysis"] : []), ...(selection.nonlinearAnalysis ? ["--nonlinear-analysis"] : [])], {
    cwd: root, windowsHide: true, timeout: timeoutMs, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, ...runners },
  });
  if (cli.status !== 0) throw new Error(`CLI failed (${cli.status}): ${cli.stderr}`);

  const fromMcp = await files(mcpOutput);
  const fromCli = await files(cliOutput);
  const comparison = [];
  for (const path of [...new Set([...fromMcp.keys(), ...fromCli.keys()])].sort()) {
    const [a, b] = [fromMcp.get(path), fromCli.get(path)];
    const kind = kinds.get(path) ?? "";
    const [stage, ...rest] = kind.split("-");
    const foreign = foreignKinds.has(rest[0]) || (rest.join("-") === "pdf" && foreignReports.has(stage));
    const status = !a || !b ? "missing" : a.equals(b) ? "identical" : foreign ? "different (another program's bytes)" : "DIFFERENT";
    comparison.push({ path, kind, status });
  }
  // A result JSON or sidecar differs only through the SHA-256 of another program's file it records.
  const foreignShas = new Set(comparison.filter((item) => item.status.startsWith("different ("))
    .map((item) => createHash("sha256").update(fromMcp.get(item.path)).digest("hex")));
  for (const item of comparison.filter((entry) => entry.status === "DIFFERENT" && entry.path.endsWith(".json"))) {
    if ([...foreignShas].some((sha) => fromMcp.get(item.path).toString("utf8").includes(sha))) item.status = "different (records another program's file)";
  }
  const failures = comparison.filter((item) => item.status === "DIFFERENT" || item.status === "missing");
  process.stdout.write(`${JSON.stringify({
    ok: failures.length === 0, jobId: manifest.jobId, seconds, root, engineeringStatus: manifest.engineeringStatus,
    stages: manifest.summary.stages, runners: manifest.summary.runners, comparison,
  }, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
} finally { await client.close(); }
