// Exercise a staged, extracted, or installed payload without changing real Codex settings.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  payload: { type: "string" },
  initialize: { type: "boolean", default: false },
  relocate: { type: "boolean", default: false },
  "skip-fempython": { type: "boolean", default: false },
  // JRSNAP results (*.DB1) are not in git, so the Aggre-SE calculation runs only on a supplied project.
  "aggrese-xml": { type: "string" },
  // WebPier's own sample input (schema 2) unless another one is given.
  "webpier-input": { type: "string", default: join(import.meta.dirname, "..", "..", "WebPier", "pre", "input.json") },
  "skip-webpier": { type: "boolean", default: false },
  "work-directory": { type: "string" },
} });
const progress = message => process.stderr.write(`[payload verification] ${message}\n`);
assert(values.payload && isAbsolute(values.payload), "--payload must be an absolute staged/extracted/installed payload directory");
if (values["work-directory"]) assert(isAbsolute(values["work-directory"]), "--work-directory must be absolute and new");
if (values["aggrese-xml"]) assert(isAbsolute(values["aggrese-xml"]), "--aggrese-xml must be an absolute Aggre-SE project XML path");
assert(isAbsolute(values["webpier-input"]), "--webpier-input must be an absolute WebPier input (schema 2) path");
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
  if (!values["skip-webpier"]) {
    // GridLayoutPdf comes from its release wheel, so the environment is built without git (PATH has only System32).
    const probe = "import sys,json,gridlayoutpdf,pymupdf,reportlab;print(json.dumps({'executable':sys.executable,'prefix':sys.prefix,'basePrefix':sys.base_prefix,'modules':{'gridlayoutpdf':gridlayoutpdf.__file__,'pymupdf':pymupdf.__file__,'reportlab':reportlab.__file__}}))";
    const python = await new Promise((accept, reject) => {
      const child = spawn(layout.webPierPython, ["-I", "-c", probe], { cwd: work, env, windowsHide: true, timeout: 60_000 });
      let stdout = "", stderr = "";
      child.stdout.on("data", data => { stdout += data; });
      child.stderr.on("data", data => { stderr += data; });
      child.on("error", reject);
      child.on("close", code => {
        if (code !== 0) return reject(new Error(`WebPier Python path probe failed: ${stderr}`));
        try { accept(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    });
    for (const [name, location] of Object.entries({ executable: python.executable, prefix: python.prefix, ...python.modules })) {
      assert(location && !relative(layout.webPier, resolve(location)).startsWith(".."), `WebPier ${name} resolved outside engines/WebPier: ${location}`);
    }
    assert(!relative(dataRoot, resolve(python.basePrefix)).startsWith(".."), `WebPier CPython home resolved outside isolated data root: ${python.basePrefix}`);
    evidence.webPierPython = python;
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
  for (const key of ["capacita", "soilstructure", "aggrese", ...(!values["skip-fempython"] ? ["fempython"] : []), ...(!values["skip-webpier"] ? ["webpier"] : [])]) {
    assert.equal(capabilities.engines[key].enabled, true, `${key} must be enabled`);
  }
  const listed = await client.listTools();
  for (const name of ["get_capabilities", "webdan_calculate", "soilstructure_calculate", "fempython_calculate", "aggrese_inspect", "aggrese_calculate", "webpier_get_contract", "webpier_generate", "read_artifact"]) {
    assert(listed.tools.some(tool => tool.name === name), `Missing tool ${name}`);
  }
  evidence.checks.push("MCP initialization, tool discovery, engine availability");

  async function download(result) {
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
    return artifacts;
  }

  async function calculate(tool, fixture, toolArgs, expectedNames, inspect) {
    progress(`Running ${tool} and checking its artifacts...`);
    const source = fixture === null ? {} : { input: await readFile(join(import.meta.dirname, "fixtures", fixture), "utf8") };
    const result = await call(tool, { ...source, ...toolArgs });
    assert.equal(result.ok, true, `${tool} failed`);
    assert.equal(result.executionStatus, "success", `${tool} did not execute successfully`);
    const metadata = await call("get_job", { jobId: result.jobId });
    assert.equal(metadata.jobId, result.jobId);
    const artifacts = await download(result);
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
  if (values["aggrese-xml"]) {
    // Inputs are read in place by path: copy the project folder (XML and JRSNAP results) under the allowed root.
    const project = join(inputs, "aggrese");
    await cp(dirname(resolve(values["aggrese-xml"])), project, { recursive: true });
    const inputPath = join(project, basename(values["aggrese-xml"]));
    const inspected = await call("aggrese_inspect", { inputPath });
    assert(inspected.summary.cases.length > 0, "Aggre-SE inspect found no cases");
    await calculate("aggrese_calculate", null, { inputPath, generateSummaryExcel: true }, ["result.json", "summary.xlsx"]);
  }
  if (!values["skip-webpier"]) {
    // JRSNAPHeadless is not bundled: the 出力項目 before the seismic ones (0500-0622) are generated in one generation of
    // the input choosing them (WebPier decision 72), and the JRSNAP ones are reported missing.
    const contract = await call("webpier_get_contract");
    const items = new Map(contract.outputs.map(output => [output.key, output]));
    const withoutJrsnap = ["ground_model", "reactions", "longitudinal", "longitudinal_frame_analysis", "transverse",
      "transverse_frame_analysis"];
    for (const key of withoutJrsnap) assert.equal(items.get(key)?.available, true, `WebPier ${key} must be available without JRSNAP`);
    for (const key of ["longitudinal_seismic", "transverse_seismic"]) {
      assert.deepEqual(items.get(key)?.missingRunners, ["jrsnap"], `WebPier ${key} must report JRSNAP missing`);
    }
    evidence.webPier = { engineVersion: contract.engineVersion, unavailableOutputs: contract.unavailableOutputs };
    const inputPath = join(inputs, "webpier", "input.json");
    await mkdir(dirname(inputPath));
    const document = JSON.parse(await readFile(values["webpier-input"], "utf8"));
    document.outputs = Object.fromEntries([...items.keys()].map(key => [key, withoutJrsnap.includes(key)]));
    await writeFile(inputPath, JSON.stringify(document, null, 2), "utf8");
    evidence.webPier.input = { source: values["webpier-input"], outputs: withoutJrsnap,
      sha256: createHash("sha256").update(await readFile(inputPath)).digest("hex") };
    const validated = await call("webpier_validate", { inputPath });
    assert.equal(validated.ok, true, "WebPier input did not validate");
    const stages = ["0500", "0600", "0610", "0611", "0612", "0620", "0621", "0622"];
    assert.deepEqual(validated.summary.stages, stages, "WebPier input must choose the stages 0500-0622");
    progress("Running webpier_generate (0500-0622) and checking its artifacts...");
    const result = await call("webpier_generate", { inputPath });
    assert.equal(result.ok, true, `webpier_generate failed: ${JSON.stringify(result.errors ?? result.messages)}`);
    assert.equal(result.executionStatus, "success");
    const artifacts = await download(result);
    for (const stage of stages) {
      assert([...artifacts.keys()].some(name => name.includes(`${stage}_`) && name.endsWith(".pdf")), `webpier_generate returned no ${stage} report PDF`);
      assert([...artifacts.keys()].some(name => name.includes(`${stage}_`) && name.endsWith(".json")), `webpier_generate returned no ${stage} result JSON`);
    }
    evidence.engines.push({ tool: "webpier_generate", outputs: withoutJrsnap, jobId: result.jobId, executionStatus: result.executionStatus,
      engineeringStatus: result.engineeringStatus, artifacts: result.artifacts.map(({ relativePath, name, bytes, sha256 }) => ({ path: relativePath ?? name, bytes, sha256 })) });
    progress(`webpier_generate complete: ${result.artifacts.length} verified artifacts.`);
    evidence.checks.push("WebPier stages 0500-0622 without JRSNAP, artifacts SHA-256/PDF checks");
  }
  {
    // Skills are copied into an isolated home and removed again; the real Claude Code / Codex folders are not used.
    progress("Placing and removing the bundled skills in an isolated home...");
    const { runAction } = await import(pathToFileURL(launcher));
    const { checkSkills, listSkills } = await import(pathToFileURL(join(payload, "skills.mjs")));
    const skillsHome = join(work, "skills-home");
    const skillLayout = createLayout(payload, { dataRoot, allowedRoot: inputs, codexHome, skillsHome }, env);
    const bundled = await listSkills(skillLayout.skills);
    assert(bundled.length > 0, "Payload has no skills");
    try {
      await runAction("register-codex", skillLayout, {}, { initialize: async () => {}, log: () => {} });
      const placed = await checkSkills({ installRoot: payload, sourceRoot: skillLayout.skills });
      assert.equal(placed.length, bundled.length * skillLayout.skillTargets.length);
      evidence.skills = { bundled: bundled.map(skill => skill.name), placed };
    } finally {
      await runAction("unregister-codex", skillLayout, {}, { log: () => {} });
    }
    for (const path of evidence.skills.placed) await assert.rejects(readFile(join(path, "SKILL.md")), { code: "ENOENT" }, `Skill remained after unregister: ${path}`);
    evidence.checks.push("Skills copied to both clients' folders with matching SHA-256 and removed by unregister");
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
