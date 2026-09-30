import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      STRUCTURAL_MCP_ALLOWED_OUTPUT_ROOTS: jobRoot,
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
    "materialize_artifact",
    "read_text_artifact",
    "soilstructure_calculate",
    "soilstructure_export_sdc",
    "soilstructure_get_runner_contract",
    "soilstructure_get_schema",
    "soilstructure_ground_displacement",
    "soilstructure_validate",
    "steeldan_calculate",
    "webdan_calculate",
    "webdan_compose_wdj",
    "webdan_inspect",
    "webdan_validate",
  ]);
  const capabilities = await client.callTool({ name: "get_capabilities", arguments: {} });
  assert.equal(capabilities.isError, undefined);
  const engines = (capabilities.structuredContent as {
    engines: {
      capacita: { enabled: boolean; tools: string[] };
      soilstructure: { enabled: boolean; outputFormats: string[]; tools: string[] };
      steeldan: { enabled: boolean; readiness: string };
    };
  }).engines;
  assert.equal(engines.capacita.enabled, true);
  assert.deepEqual(engines.capacita.tools, [
    "webdan_inspect",
    "webdan_validate",
    "webdan_compose_wdj",
    "webdan_calculate",
  ]);
  assert.equal(engines.soilstructure.enabled, true);
  assert.deepEqual(engines.soilstructure.outputFormats, ["json", "pdf", "sdc", "jot"]);
  assert.deepEqual(engines.soilstructure.tools, [
    "soilstructure_get_schema",
    "soilstructure_get_runner_contract",
    "soilstructure_validate",
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

test("publishes the SoilStructure schema and standalone runner contract", async () => {
  const schemaResult = await client.callTool({
    name: "soilstructure_get_schema",
    arguments: { includeExamples: true },
  });
  assert.equal(schemaResult.isError, undefined);
  const schema = schemaResult.structuredContent as {
    documentSchema: {
      properties: { pileType: { enum: number[] }; sdcExport: unknown };
      allOf: Array<{ then?: { properties?: { pileType?: { enum: number[] } } } }>;
    };
    operationRequirements: { sdc: { requiredSections: string[]; supportedPileTypes: number[]; unsupportedPileTypes: number[] } };
    examples: { sdcExport: { equivalentWidthPileCount: number } };
  };
  assert.deepEqual(schema.documentSchema.properties.pileType.enum, [4, 5, 6]);
  const sdcPileTypeRule = schema.documentSchema.allOf.find((rule) => rule.then?.properties?.pileType?.enum);
  assert.deepEqual(sdcPileTypeRule?.then?.properties?.pileType?.enum, [4, 5, 6]);
  assert.ok(schema.documentSchema.properties.sdcExport);
  assert.ok(schema.operationRequirements.sdc.requiredSections.includes("sdcExport"));
  assert.deepEqual(schema.operationRequirements.sdc.supportedPileTypes, [4, 5, 6]);
  assert.deepEqual(schema.operationRequirements.sdc.unsupportedPileTypes, []);
  assert.equal(schema.examples.sdcExport.equivalentWidthPileCount, 3);

  const contractResult = await client.callTool({ name: "soilstructure_get_runner_contract", arguments: {} });
  assert.equal(contractResult.isError, undefined);
  const contract = contractResult.structuredContent as {
    runner: { readable: boolean; path: string };
    contract: { commands: { validate: { arguments: string[] }; sdc: { artifacts: string[]; restrictions: string[] } } };
    pythonTemplate: string;
  };
  assert.equal(contract.runner.readable, true);
  assert.equal(contract.runner.path, fakeRunner);
  assert.ok(contract.contract.commands.validate.arguments.includes("--operation"));
  assert.ok(contract.contract.commands.sdc.artifacts.includes("report.sdc"));
  assert.match(contract.contract.commands.sdc.restrictions.join("\n"), /steelPipeDiameterM.*pile\.diameterM/);
  assert.match(contract.contract.commands.sdc.restrictions.join("\n"), /steelPipeThicknessMm.*corrosionAllowanceMm/);
  assert.match(contract.contract.commands.sdc.restrictions.join("\n"), /引抜き側.*f\/g/);
  assert.match(contract.pythonTemplate, /sha256/);
  assert.match(contract.pythonTemplate, /os\.replace/);
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

test("inspects, validates, and composes Capacita WDJ artifacts", async () => {
  for (const name of ["webdan_inspect", "webdan_validate"] as const) {
    const result = await client.callTool({ name, arguments: { input: "{}" } });
    assert.equal(result.isError, undefined);
    const structured = result.structuredContent as {
      summary: { command: string };
      artifacts: Array<{ artifactId: string; name: string }>;
    };
    assert.equal(structured.summary.command, name === "webdan_inspect" ? "inspect-rc" : "validate-rc");
    assert.ok(structured.artifacts.some((item) => item.name === "result.json"));
  }

  const composed = await client.callTool({
    name: "webdan_compose_wdj",
    arguments: {
      input: "{}",
      request: {
        member: { m_no: 1, section: { shape: "rectangle", width_mm: 350, height_mm: 350 } },
        point: { index: 1 },
        rebar: { upper: { diameter_mm: 19, count: 2 }, lower: { diameter_mm: 19, count: 2 } },
      },
    },
  });
  assert.equal(composed.isError, undefined);
  const structured = composed.structuredContent as {
    jobId: string;
    artifacts: Array<{ artifactId: string; name: string }>;
  };
  const wdj = structured.artifacts.find((item) => item.name === "generated.wdj");
  assert.ok(wdj);
  const read = await client.callTool({
    name: "read_text_artifact",
    arguments: { jobId: structured.jobId, artifactId: wdj.artifactId },
  });
  assert.equal(read.isError, undefined);
  assert.doesNotThrow(() => JSON.parse((read.structuredContent as { text: string }).text));
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

test("validates SoilStructure operation input without publishing artifacts", async () => {
  const result = await client.callTool({
    name: "soilstructure_validate",
    arguments: { inputPath: resolve(fixtureRoot, "soilstructure-features.json"), operation: "sdc" },
  });
  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as {
    tool: string;
    ok: boolean;
    summary: { command: string };
    artifacts: unknown[];
  };
  assert.equal(structured.tool, "soilstructure_validate");
  assert.equal(structured.ok, true);
  assert.equal(structured.summary.command, "validate");
  assert.deepEqual(structured.artifacts, []);
});

test("materializes verified artifacts only inside allowed output roots", async () => {
  const calculated = await client.callTool({
    name: "soilstructure_calculate",
    arguments: { inputPath: resolve(fixtureRoot, "soilstructure.json"), generatePdf: true },
  });
  assert.equal(calculated.isError, undefined);
  const calculation = calculated.structuredContent as {
    jobId: string;
    artifacts: Array<{ artifactId: string; name: string; bytes: number; sha256: string }>;
  };
  const report = calculation.artifacts.find((artifact) => artifact.name === "report.pdf");
  assert.ok(report);
  const exportDirectory = resolve(jobRoot, "materialized");
  await mkdir(exportDirectory);
  const destinationPath = resolve(exportDirectory, "04_地盤のモデル化.pdf");

  const first = await client.callTool({
    name: "materialize_artifact",
    arguments: { jobId: calculation.jobId, artifactId: report.artifactId, destinationPath },
  });
  assert.equal(first.isError, undefined);
  assert.equal((await readFile(destinationPath)).length, report.bytes);

  const conflict = await client.callTool({
    name: "materialize_artifact",
    arguments: { jobId: calculation.jobId, artifactId: report.artifactId, destinationPath },
  });
  assert.equal(conflict.isError, true);
  assert.match(JSON.stringify(conflict.structuredContent), /overwrite=true/);

  await writeFile(destinationPath, "stale", "utf8");
  const replaced = await client.callTool({
    name: "materialize_artifact",
    arguments: { jobId: calculation.jobId, artifactId: report.artifactId, destinationPath, overwrite: true },
  });
  assert.equal(replaced.isError, undefined);
  const replacement = replaced.structuredContent as { overwritten: boolean; sha256: string };
  assert.equal(replacement.overwritten, true);
  assert.equal(replacement.sha256, report.sha256);
  assert.equal((await readFile(destinationPath)).length, report.bytes);

  const outside = await client.callTool({
    name: "materialize_artifact",
    arguments: {
      jobId: calculation.jobId,
      artifactId: report.artifactId,
      destinationPath: resolve(fixtureRoot, "must-not-be-created.pdf"),
    },
  });
  assert.equal(outside.isError, true);
  assert.match(JSON.stringify(outside.structuredContent), /ALLOWED_OUTPUT_ROOTS/);
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
