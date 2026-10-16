// Exercise a staged, extracted, or installed payload without changing real Codex settings.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  payload: { type: "string" },
  initialize: { type: "boolean", default: false },
  relocate: { type: "boolean", default: false },
  "skip-fempython": { type: "boolean", default: false },
  "work-directory": { type: "string" },
} });
const progress = message => process.stderr.write(`[payload verification] ${message}\n`);
assert(values.payload && isAbsolute(values.payload), "--payload must be an absolute staged/extracted/installed payload directory");
if (values["work-directory"]) assert(isAbsolute(values["work-directory"]), "--work-directory must be absolute and new");
const work = values["work-directory"] ? resolve(values["work-directory"]) : await mkdtemp(join(tmpdir(), "structural-mcp-verify-"));
if (values["work-directory"]) await mkdir(work);
const sourcePayload = resolve(values.payload);
const payload = values.relocate ? join(work, "移動先 with spaces", "structural-mcp") : sourcePayload;
progress(`Evidence directory: ${work}`);
if (values.relocate) {
  progress("Copying payload to the relocation directory...");
  // Python environments contain absolute paths and must be recreated at the destination.
  await cp(sourcePayload, payload, { recursive: true, filter: (path) => !/[\\/](\.venv|__pycache__)([\\/]|$)/.test(path) });
  progress("Relocation copy complete.");
}
const inputs = join(work, "inputs");
const dataRoot = join(work, "data");
const codexHome = join(work, "codex-home");
await Promise.all([mkdir(inputs), mkdir(dataRoot), mkdir(codexHome)]);
const node = join(payload, "runtime", "node", "node.exe");
const launcher = join(payload, "launcher.mjs");
const args = ["--data-root", dataRoot, "--allowed-root", inputs, "--codex-home", codexHome];
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
  !/^(STRUCTURAL_MCP_|PYTHON|UV_|DOTNET_|VIRTUAL_ENV$|PATH$|NODE_OPTIONS$|NODE_PATH$|CODEX_HOME$)/i.test(key)));
env.CODEX_HOME = codexHome;
// Bundled Node/.NET/Python must work without development runtimes on PATH.
env.PATH = `${env.SystemRoot ?? "C:\\Windows"}\\System32;${env.SystemRoot ?? "C:\\Windows"}`;
env.DOTNET_ROOT = join(work, "no-installed-dotnet");
env.DOTNET_ROOT_X64 = env.DOTNET_ROOT;

async function run(command, commandArgs) {
  await new Promise((accept, reject) => {
    const child = spawn(command, commandArgs, { cwd: work, env, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? accept() : reject(new Error(`Launcher exited ${code ?? signal}`)));
  });
}

async function verifyManifest() {
  const manifest = JSON.parse(await readFile(join(payload, "release-manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert(Array.isArray(manifest.files) && manifest.files.length > 0, "Release manifest has no files");
  const paths = new Set();
  for (const file of manifest.files) {
    assert(typeof file.path === "string" && !isAbsolute(file.path), "Manifest path must be relative");
    const target = resolve(payload, file.path);
    assert(!relative(payload, target).startsWith(`..${sep}`) && target !== payload, "Manifest path escaped payload");
    assert(!paths.has(file.path.toLowerCase()), `Duplicate manifest path: ${file.path}`);
    paths.add(file.path.toLowerCase());
    const bytes = await readFile(target);
    assert.equal(bytes.length, file.bytes, `Size mismatch: ${file.path}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, `Hash mismatch: ${file.path}`);
  }
  return { version: manifest.version, channel: manifest.channel, files: manifest.files.length };
}

const evidence = { sourcePayload, payload, work, relocated: values.relocate, initialized: false, engines: [], checks: [] };
let client;
try {
  progress("Checking manifest file sizes and SHA-256 values...");
  evidence.manifest = await verifyManifest();
  progress(`Integrity check complete: ${evidence.manifest.files} files.`);
  if (values.initialize) {
    progress("Initializing the isolated Python environment and checking launcher health...");
    await run(node, [launcher, "initialize", ...args]);
    evidence.initialized = true;
    progress("Initialization complete.");
  }
  const requireFromPayload = createRequire(join(payload, "server", "package.json"));
  const { createLayout, registrationFor } = await import(pathToFileURL(launcher));
  const layout = createLayout(payload, { dataRoot, allowedRoot: inputs, codexHome }, env);
  const registration = registrationFor(layout);
  if (!values["skip-fempython"]) {
    const pythonProbe = "import sys,json,fem,numpy,scipy;print(json.dumps({'executable':sys.executable,'prefix':sys.prefix,'basePrefix':sys.base_prefix,'modules':{'fem':fem.__file__,'numpy':numpy.__file__,'scipy':scipy.__file__}}))";
    const python = await new Promise((accept, reject) => {
      const child = spawn(layout.python, ["-I", "-c", pythonProbe], { cwd: work, env, windowsHide: true, timeout: 60_000 });
      let stdout = "", stderr = "";
      child.stdout.on("data", data => { stdout += data; });
      child.stderr.on("data", data => { stderr += data; });
      child.on("error", reject);
      child.on("close", code => {
        if (code !== 0) return reject(new Error(`Python path probe failed: ${stderr}`));
        try { accept(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    });
    for (const [name, location] of Object.entries({ executable: python.executable, prefix: python.prefix, ...python.modules })) {
      assert(location && !relative(payload, resolve(location)).startsWith(".."), `${name} resolved outside payload: ${location}`);
    }
    assert(!relative(dataRoot, resolve(python.basePrefix)).startsWith(".."), `CPython home resolved outside isolated data root: ${python.basePrefix}`);
    evidence.python = python;
  }
  const { Client } = await import(pathToFileURL(requireFromPayload.resolve("@modelcontextprotocol/sdk/client/index.js")));
  const { StdioClientTransport } = await import(pathToFileURL(requireFromPayload.resolve("@modelcontextprotocol/sdk/client/stdio.js")));
  client = new Client({ name: "structural-mcp-payload-smoke", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: registration.command, args: registration.args, cwd: work,
    env: { ...env, ...registration.env }, stderr: "inherit" }));

  async function call(name, toolArgs = {}, expectError = false) {
    const result = await client.callTool({ name, arguments: toolArgs }, undefined, { timeout: 300_000 });
    if (expectError) {
      assert.equal(result.isError, true, `${name} must reject the invalid request`);
      return result;
    }
    assert(!result.isError, `${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
    assert(result.structuredContent, `${name}: no structured response`);
    return result.structuredContent;
  }

  const capabilities = await call("get_capabilities");
  evidence.capabilities = capabilities;
  for (const key of ["capacita", "soilstructure", ...(!values["skip-fempython"] ? ["fempython"] : [])]) {
    assert.equal(capabilities.engines[key].enabled, true, `${key} must be enabled`);
  }
  const listed = await client.listTools();
  for (const name of ["get_capabilities", "webdan_calculate", "soilstructure_calculate", "fempython_calculate", "read_artifact"]) {
    assert(listed.tools.some(tool => tool.name === name), `Missing tool ${name}`);
  }
  evidence.checks.push("MCP initialization, tool discovery, engine availability");

  async function calculate(tool, fixture, toolArgs, expectedNames, inspect) {
    progress(`Running ${tool} and checking its artifacts...`);
    const input = await readFile(join(import.meta.dirname, "fixtures", fixture), "utf8");
    const result = await call(tool, { input, ...toolArgs });
    assert.equal(result.ok, true, `${tool} failed`);
    assert.equal(result.executionStatus, "success", `${tool} did not execute successfully`);
    const metadata = await call("get_job", { jobId: result.jobId });
    assert.equal(metadata.jobId, result.jobId);
    const artifacts = new Map();
    for (const artifact of result.artifacts) {
      const chunks = [];
      let offset = 0;
      for (;;) {
        const chunk = await call("read_artifact", { jobId: result.jobId, artifactId: artifact.artifactId, offsetBytes: offset });
        const bytes = Buffer.from(chunk.base64, "base64");
        assert.equal(chunk.offsetBytes, offset);
        assert.equal(chunk.nextOffsetBytes, offset + bytes.length);
        assert.equal(chunk.totalBytes, artifact.bytes);
        chunks.push(bytes);
        offset = chunk.nextOffsetBytes;
        if (chunk.eof) break;
        assert(bytes.length > 0 && offset < artifact.bytes, "Artifact download made no progress");
      }
      const contents = Buffer.concat(chunks);
      assert.equal(contents.length, artifact.bytes);
      assert.equal(createHash("sha256").update(contents).digest("hex"), artifact.sha256);
      if (artifact.name.endsWith(".pdf")) assert.equal(contents.subarray(0, 5).toString("ascii"), "%PDF-");
      artifacts.set(artifact.name, contents);
    }
    for (const name of expectedNames) assert(artifacts.has(name), `${tool} missing ${name}`);
    const parsed = JSON.parse(artifacts.get("result.json").toString("utf8"));
    if (inspect) inspect(parsed);
    evidence.engines.push({ tool, jobId: result.jobId, executionStatus: result.executionStatus,
      engineeringStatus: result.engineeringStatus, artifacts: result.artifacts.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) });
    progress(`${tool} complete: ${result.artifacts.length} verified artifacts.`);
  }

  await calculate("webdan_calculate", "capacita.wdj", { outputFormat: "pdf" }, ["result.json", "report.pdf"]);
  await calculate("soilstructure_calculate", "soilstructure.json", { generatePdf: true, generateExcel: false }, ["result.json", "report.pdf"]);
  if (!values["skip-fempython"]) {
    await calculate("fempython_calculate", "fempython.json", { generatePdf: true, generatePik: true,
      generatePickupDisplacementCsv: true, generatePickupReactionCsv: true },
    ["result.json", "report.pdf", "pickup.pik", "pickup-displacement.csv", "pickup-reaction.csv"], result => {
      const node = result.analysisResultSet.results[0].node_displacements.find(row => row.node_id === "2");
      assert(node, "FEMPython tip-node result missing");
      assert(Math.abs(node.components.dx - 0.0004) < 1e-10, `Unexpected FEMPython cantilever dx: ${node.components.dx}`);
      assert(!result.stale, "Saved stale result was reused");
    });
  }
  const outside = join(work, "outside.json");
  await writeFile(outside, await readFile(join(import.meta.dirname, "fixtures", "soilstructure.json")));
  await call("soilstructure_validate", { inputPath: outside, operation: "pile" }, true);
  await call("soilstructure_calculate", { input: "{invalid-json", generatePdf: false }, true);
  evidence.checks.push("Real engine calculations and artifact SHA-256/PDF checks", "Allowed-root rejection", "Malformed JSON rejection");
  evidence.ok = true;
  progress("All requested payload checks passed.");
} catch (error) {
  evidence.ok = false;
  evidence.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (client) await client.close().catch(() => undefined);
  await writeFile(join(work, "verification.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
