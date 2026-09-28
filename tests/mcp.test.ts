import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = resolve(repositoryRoot, "tests/fixtures");
const fakeRunner = resolve(fixtureRoot, "fake-runner.mjs");
let jobRoot: string;
let client: Client;

async function connect(overrides: Record<string, string> = {}): Promise<Client> {
  const connected = new Client({ name: "structural-mcp-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(repositoryRoot, "dist/src/index.js")],
    env: {
      ...process.env,
      STRUCTURAL_MCP_WEBDAN_RUNNER: fakeRunner,
      STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER: fakeRunner,
      STRUCTURAL_MCP_JOB_ROOT: jobRoot,
      STRUCTURAL_MCP_ALLOWED_ROOTS: fixtureRoot,
      STRUCTURAL_MCP_ENABLE_STEELDAN: "true",
      ...overrides,
    },
  });
  await connected.connect(transport);
  return connected;
}

before(async () => {
  jobRoot = await mkdtemp(resolve(tmpdir(), "structural-mcp-test-"));
  client = await connect();
});

after(async () => {
  await client.close();
  await rm(jobRoot, { recursive: true, force: true });
});

test("lists all tools and reports independently available runners", async () => {
  const result = await client.listTools();
  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), [
    "get_capabilities",
    "get_environment_template",
    "get_job",
    "read_text_artifact",
    "soilstructure_calculate",
    "soilstructure_export_sdc",
    "soilstructure_ground_displacement",
    "steeldan_calculate",
    "webdan_calculate",
  ]);
  const capabilities = await client.callTool({ name: "get_capabilities", arguments: {} });
  assert.equal(capabilities.isError, undefined);
  const engines = (capabilities.structuredContent as {
    engines: {
      capacita: { enabled: boolean };
      soilstructure: { enabled: boolean; outputFormats: string[]; tools: string[] };
      steeldan: { enabled: boolean; readiness: string };
    };
  }).engines;
  assert.equal(engines.capacita.enabled, true);
  assert.equal(engines.soilstructure.enabled, true);
  assert.deepEqual(engines.soilstructure.outputFormats, ["json", "pdf", "sdc", "jot"]);
  assert.deepEqual(engines.soilstructure.tools, [
    "soilstructure_calculate",
    "soilstructure_export_sdc",
    "soilstructure_ground_displacement",
  ]);
  assert.equal(engines.steeldan.enabled, true);
  assert.equal(engines.steeldan.readiness, "experimental");

  const environmentTemplate = await client.callTool({
    name: "get_environment_template",
    arguments: { engine: "soilstructure" },
  });
  assert.equal(environmentTemplate.isError, undefined);
  const environment = environmentTemplate.structuredContent as {
    fileName: string;
    content: string;
    variables: Array<{ engine: string; name: string; value: string; readable: boolean; source: string }>;
  };
  assert.equal(environment.fileName, ".env");
  assert.equal(environment.variables.length, 1);
  const soilStructure = environment.variables.find((item) => item.engine === "soilstructure");
  assert.deepEqual(soilStructure, {
    engine: "soilstructure",
    name: "STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER",
    value: fakeRunner,
    readable: true,
    source: "environment",
  });
  assert.match(environment.content, /STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER=/);
});

test("calls Capacita through the generalized runner and reads an artifact", async () => {
  const result = await client.callTool({
    name: "webdan_calculate",
    arguments: { inputPath: resolve(fixtureRoot, "model.wdj"), outputFormat: "markdown" },
  });
  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as { jobId: string; ok: boolean; artifacts: Array<{ artifactId: string; name: string }> };
  assert.equal(structured.ok, true);
  assert.ok(structured.artifacts.some((item) => item.name === "report.md"));
  const job = await client.callTool({ name: "get_job", arguments: { jobId: structured.jobId } });
  assert.equal(job.isError, undefined);
  assert.equal((job.structuredContent as { engine: string }).engine, "webdan2");
  const read = await client.callTool({ name: "read_text_artifact", arguments: { jobId: structured.jobId, artifactId: "result", maxBytes: 4096 } });
  assert.equal(read.isError, undefined);
  assert.match((read.structuredContent as { text: string }).text, /"command":"run-rc"/);
});

test("preserves the experimental SteelDan adapter", async () => {
  const result = await client.callTool({
    name: "steeldan_calculate",
    arguments: { inputPath: resolve(fixtureRoot, "model.wsj"), generatePdf: true },
  });
  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as { ok: boolean; readiness: string; engineeringStatus: string; artifacts: Array<{ name: string }> };
  assert.equal(structured.ok, true);
  assert.equal(structured.readiness, "experimental");
  assert.equal(structured.engineeringStatus, "not_ok");
  assert.ok(structured.artifacts.some((item) => item.name === "report.pdf"));
});

test("runs SoilStructure from a JSON path with PDF enabled by default", async () => {
  const result = await client.callTool({
    name: "soilstructure_calculate",
    arguments: { inputPath: resolve(fixtureRoot, "soilstructure.json") },
  });
  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as {
    jobId: string;
    tool: string;
    engine: string;
    ok: boolean;
    artifacts: Array<{ artifactId: string; name: string }>;
  };
  assert.equal(structured.tool, "soilstructure_calculate");
  assert.equal(structured.engine, "soilstructure");
  assert.equal(structured.ok, true);
  assert.ok(structured.artifacts.some((item) => item.name === "result.json"));
  assert.ok(structured.artifacts.some((item) => item.name === "report.pdf"));
  const read = await client.callTool({ name: "read_text_artifact", arguments: { jobId: structured.jobId, artifactId: "result" } });
  assert.equal(read.isError, undefined);
  assert.match((read.structuredContent as { text: string }).text, /"command":"run"/);
});

test("accepts inline SoilStructure JSON and enforces exactly one source", async () => {
  const inline = await readFile(resolve(fixtureRoot, "soilstructure.json"), "utf8");
  const success = await client.callTool({
    name: "soilstructure_calculate",
    arguments: { input: inline, generatePdf: false },
  });
  assert.equal(success.isError, undefined);
  const artifacts = (success.structuredContent as { artifacts: Array<{ name: string }> }).artifacts;
  assert.ok(artifacts.some((item) => item.name === "result.json"));
  assert.ok(!artifacts.some((item) => item.name === "report.pdf"));

  const both = await client.callTool({
    name: "soilstructure_calculate",
    arguments: { input: inline, inputPath: resolve(fixtureRoot, "soilstructure.json") },
  });
  assert.equal(both.isError, true);
  assert.match(JSON.stringify(both.structuredContent), /どちらか一方/);

  const missing = await client.callTool({ name: "soilstructure_calculate", arguments: {} });
  assert.equal(missing.isError, true);
  const invalid = await client.callTool({ name: "soilstructure_calculate", arguments: { input: "not json" } });
  assert.equal(invalid.isError, true);
  assert.match(JSON.stringify(invalid.structuredContent), /有効なJSON/);
});

test("exports SoilStructure SDC artifacts", async () => {
  const result = await client.callTool({
    name: "soilstructure_export_sdc",
    arguments: { inputPath: resolve(fixtureRoot, "soilstructure-features.json") },
  });
  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as {
    jobId: string;
    tool: string;
    engine: string;
    artifacts: Array<{ artifactId: string; name: string; mediaType: string }>;
  };
  assert.equal(structured.tool, "soilstructure_export_sdc");
  assert.equal(structured.engine, "soilstructure");
  assert.ok(structured.artifacts.some((item) => item.name === "result.json"));
  assert.ok(structured.artifacts.some((item) =>
    item.name === "report.sdc" && item.mediaType === "text/plain; charset=shift_jis"));
  const sdc = structured.artifacts.find((item) => item.name === "report.sdc");
  assert.ok(sdc);
  const read = await client.callTool({
    name: "read_text_artifact",
    arguments: { jobId: structured.jobId, artifactId: sdc.artifactId },
  });
  assert.equal(read.isError, true);
  assert.match(JSON.stringify(read.structuredContent), /UTF-8/);
});

test("runs SoilStructure ground displacement with optional PDF and JOT artifacts", async () => {
  const inline = await readFile(resolve(fixtureRoot, "soilstructure-features.json"), "utf8");
  const result = await client.callTool({
    name: "soilstructure_ground_displacement",
    arguments: { input: inline, generatePdf: true, generateJot: true },
  });
  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as {
    tool: string;
    artifacts: Array<{ name: string }>;
  };
  assert.equal(structured.tool, "soilstructure_ground_displacement");
  assert.ok(structured.artifacts.some((item) => item.name === "result.json"));
  assert.ok(structured.artifacts.some((item) => item.name === "report.pdf"));
  assert.ok(structured.artifacts.some((item) => item.name === "ground-displacementL1.JOT"));
  assert.ok(structured.artifacts.some((item) => item.name === "ground-displacementL2.JOT"));

  const withoutOptionalArtifacts = await client.callTool({
    name: "soilstructure_ground_displacement",
    arguments: { input: inline, generatePdf: false, generateJot: false },
  });
  assert.equal(withoutOptionalArtifacts.isError, undefined);
  const names = (withoutOptionalArtifacts.structuredContent as { artifacts: Array<{ name: string }> })
    .artifacts.map((item) => item.name);
  assert.deepEqual(names, ["result.json"]);
});

test("starts and runs SoilStructure when the Capacita runner is missing", async () => {
  const isolatedJobs = await mkdtemp(resolve(tmpdir(), "structural-mcp-independent-"));
  const isolated = await connect({
    STRUCTURAL_MCP_WEBDAN_RUNNER: resolve(isolatedJobs, "missing-capacita.dll"),
    STRUCTURAL_MCP_JOB_ROOT: isolatedJobs,
  });
  try {
    const capabilities = await isolated.callTool({ name: "get_capabilities", arguments: {} });
    const engines = (capabilities.structuredContent as { engines: { capacita: { enabled: boolean }; soilstructure: { enabled: boolean } } }).engines;
    assert.equal(engines.capacita.enabled, false);
    assert.equal(engines.soilstructure.enabled, true);
    const result = await isolated.callTool({
      name: "soilstructure_calculate",
      arguments: { inputPath: resolve(fixtureRoot, "soilstructure.json"), generatePdf: false },
    });
    assert.equal(result.isError, undefined);
  } finally {
    await isolated.close();
    await rm(isolatedJobs, { recursive: true, force: true });
  }
});

test("rejects an input path outside allowed roots", async () => {
  const external = await mkdtemp(resolve(tmpdir(), "structural-mcp-external-"));
  try {
    const path = resolve(external, "soilstructure.json");
    await writeFile(path, await readFile(resolve(fixtureRoot, "soilstructure.json")));
    const result = await client.callTool({ name: "soilstructure_calculate", arguments: { inputPath: path } });
    assert.equal(result.isError, true);
  } finally {
    await rm(external, { recursive: true, force: true });
  }
});
