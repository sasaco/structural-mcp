import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = resolve(repositoryRoot, "tests/fixtures");
const fakeRunner = resolve(fixtureRoot, "fake-runner.mjs");
const fakeFemRunner = resolve(fixtureRoot, "fake-fempython-runner.mjs");
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
      STRUCTURAL_MCP_FEMPYTHON_RUNNER: fakeFemRunner,
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
    "fempython_calculate",
    "fempython_get_runner_contract",
    "get_capabilities",
    "get_environment_template",
    "get_job",
    "read_artifact",
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
      fempython: { enabled: boolean; readiness: string; outputFormats: string[] };
      capacita: { enabled: boolean; tools: string[] };
      soilstructure: { enabled: boolean; outputFormats: string[]; tools: string[] };
      steeldan: { enabled: boolean; readiness: string };
    };
  }).engines;
  assert.equal(engines.fempython.enabled, true);
  assert.equal(engines.fempython.readiness, "experimental");
  assert.deepEqual(engines.fempython.outputFormats, ["json", "pik", "pdf", "csv"]);
  assert.equal(engines.capacita.enabled, true);
  assert.deepEqual(engines.capacita.tools, [
    "webdan_inspect",
    "webdan_validate",
    "webdan_compose_wdj",
    "webdan_calculate",
  ]);
  assert.equal(engines.soilstructure.enabled, true);
  assert.deepEqual(engines.soilstructure.outputFormats, ["json", "pdf", "xlsx", "sdc", "jot"]);
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
    contract: { commands: {
      validate: { arguments: string[] };
      pile: { optionalArguments: string[]; artifacts: string[]; restrictions: string[] };
      sdc: { artifacts: string[]; restrictions: string[] };
    } };
    pythonTemplate: string;
  };
  assert.equal(contract.runner.readable, true);
  assert.equal(contract.runner.path, fakeRunner);
  assert.ok(contract.contract.commands.validate.arguments.includes("--operation"));
  assert.ok(contract.contract.commands.pile.optionalArguments.includes("--xlsx-output"));
  assert.ok(contract.contract.commands.pile.artifacts.includes("report.xlsx (optional)"));
  assert.match(contract.contract.commands.pile.restrictions.join("\n"), /Microsoft Excel/);
  assert.ok(contract.contract.commands.sdc.artifacts.includes("report.sdc"));
  assert.match(contract.contract.commands.sdc.restrictions.join("\n"), /steelPipeDiameterM.*pile\.diameterM/);
  assert.match(contract.contract.commands.sdc.restrictions.join("\n"), /steelPipeThicknessMm.*corrosionAllowanceMm/);
  assert.match(contract.contract.commands.sdc.restrictions.join("\n"), /引抜き側.*f\/g/);
  assert.match(contract.pythonTemplate, /sha256/);
  assert.match(contract.pythonTemplate, /os\.replace/);
  assert.match(contract.pythonTemplate, /generate_excel: bool = False/);
  assert.match(contract.pythonTemplate, /--xlsx-output/);
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
  assert.ok(!structured.artifacts.some((item) => item.name === "report.xlsx"));
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

test("generates SoilStructure Excel with and without PDF as verified job artifacts", async () => {
  const inline = await readFile(resolve(fixtureRoot, "soilstructure.json"), "utf8");
  const jobs = new Set<string>();
  for (const generatePdf of [true, false]) {
    const result = await client.callTool({
      name: "soilstructure_calculate",
      arguments: {
        ...(generatePdf ? { inputPath: resolve(fixtureRoot, "soilstructure.json") } : { input: inline }),
        generateExcel: true,
        generatePdf,
      },
    });
    assert.equal(result.isError, undefined);
    const value = result.structuredContent as {
      jobId: string;
      ok: boolean;
      artifacts: Array<{ artifactId: string; name: string; relativePath: string; mediaType: string; bytes: number; sha256: string }>;
    };
    assert.equal(value.ok, true);
    assert.ok(!jobs.has(value.jobId));
    jobs.add(value.jobId);
    assert.deepEqual(value.artifacts.map((item) => item.name).sort(),
      ["result.json", "report.xlsx", ...(generatePdf ? ["report.pdf"] : [])].sort());
    const workbook = value.artifacts.find((item) => item.name === "report.xlsx")!;
    assert.equal(workbook.relativePath, "output/report.xlsx");
    assert.equal(workbook.mediaType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const bytes = await readFile(resolve(jobRoot, value.jobId.slice(0, 10), value.jobId, workbook.relativePath));
    assert.equal(bytes.length, workbook.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), workbook.sha256);
    const job = await client.callTool({ name: "get_job", arguments: { jobId: value.jobId } });
    assert.deepEqual((job.structuredContent as { artifacts: unknown[] }).artifacts, value.artifacts);
    const read = await client.callTool({ name: "read_text_artifact", arguments: { jobId: value.jobId, artifactId: workbook.artifactId } });
    assert.equal(read.isError, true);
    assert.match(JSON.stringify(read.structuredContent), /UTF-8 text/);
  }
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

test("publishes the FrameWebforCS runner path and five-section contract", async () => {
  const contract = await client.callTool({ name: "fempython_get_runner_contract", arguments: {} });
  assert.equal(contract.isError, undefined);
  const value = contract.structuredContent as {
    runner: { path: string; readable: boolean };
    contract: { engine: string; optionalArguments: Record<string, { default: string }> };
  };
  assert.equal(value.runner.path, fakeFemRunner);
  assert.equal(value.runner.readable, true);
  assert.equal(value.contract.engine, "fempython");
  assert.equal(value.contract.optionalArguments["--pdf-sections"]?.default,
    "input,section_force,pickup_section_force,displacement,pickup_displacement");
  assert.equal(value.contract.optionalArguments["--generate-pickup-displacement-csv"]?.default, "false");
  assert.equal(value.contract.optionalArguments["--generate-pickup-reaction-csv"]?.default, "false");
  const template = await client.callTool({ name: "get_environment_template", arguments: { engine: "fempython" } });
  assert.match(JSON.stringify(template.structuredContent), /STRUCTURAL_MCP_FEMPYTHON_RUNNER/);
});

test("runs FrameWeb inline outside server roots and downloads exact PDF/PIK bytes", async () => {
  const external = await mkdtemp(resolve(tmpdir(), "structural-mcp-fem-client-"));
  try {
    const inputPath = resolve(external, "線路直角方向.json");
    await writeFile(inputPath, '{"dimension":2}');
    const result = await client.callTool({ name: "fempython_calculate", arguments: { input: await readFile(inputPath, "utf8") } });
    assert.equal(result.isError, undefined);
    const manifest = result.structuredContent as {
      jobId: string; ok: boolean; engine: string; engineeringStatus: string;
      summary: { pdfSections: string[] };
      artifacts: Array<{ artifactId: string; name: string; bytes: number; sha256: string }>;
    };
    assert.equal(manifest.ok, true);
    assert.equal(manifest.engine, "fempython");
    assert.equal(manifest.engineeringStatus, "not_checked");
    assert.deepEqual(manifest.summary.pdfSections, ["input", "section_force", "pickup_section_force", "displacement", "pickup_displacement"]);
    assert.deepEqual(manifest.artifacts.map((artifact) => artifact.name), ["result.json", "pickup.pik", "report.pdf"]);
    for (const artifact of manifest.artifacts) {
      const chunks: Buffer[] = [];
      let offset = 0;
      do {
        const read = await client.callTool({ name: "read_artifact", arguments: {
          jobId: manifest.jobId, artifactId: artifact.artifactId, offsetBytes: offset, maxBytes: 7,
        } });
        assert.equal(read.isError, undefined);
        const chunk = read.structuredContent as { base64: string; offsetBytes: number; nextOffsetBytes: number; eof: boolean; totalBytes: number };
        assert.equal(chunk.offsetBytes, offset);
        assert.equal(chunk.totalBytes, artifact.bytes);
        chunks.push(Buffer.from(chunk.base64, "base64"));
        assert.equal(chunk.nextOffsetBytes, offset + chunks.at(-1)!.length);
        offset = chunk.nextOffsetBytes;
        if (chunk.eof) break;
        assert.ok(chunks.at(-1)!.length > 0);
      } while (offset <= artifact.bytes);
      const bytes = Buffer.concat(chunks);
      assert.equal(bytes.length, artifact.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
      await writeFile(resolve(external, artifact.name), bytes);
      if (artifact.name === "report.pdf") assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      if (artifact.name === "pickup.pik") assert.match(bytes.toString("utf8"), /着目力/);
    }
  } finally { await rm(external, { recursive: true, force: true }); }
});

test("FrameWeb forwards optional output flags and selected report sections", async () => {
  const result = await client.callTool({ name: "fempython_calculate", arguments: {
    input: "{}", generatePdf: false, generatePik: false, pdfSections: ["input"],
  } });
  assert.equal(result.isError, undefined);
  const value = result.structuredContent as { summary: { generatePdf: boolean; generatePik: boolean; pdfSections: string[] }; artifacts: Array<{ name: string }> };
  assert.deepEqual(value.artifacts.map((artifact) => artifact.name), ["result.json"]);
  assert.deepEqual(value.summary, { command: "run", generatePdf: false, generatePik: false,
    generatePickupDisplacementCsv: false, generatePickupReactionCsv: false, pdfSections: ["input"] });
});

test("FrameWeb exposes independent PICKUP CSV options and downloads exact UTF-8 bytes", async () => {
  const tools = await client.listTools();
  const schema = tools.tools.find((tool) => tool.name === "fempython_calculate")!.inputSchema;
  for (const option of ["generatePickupDisplacementCsv", "generatePickupReactionCsv"]) {
    assert.deepEqual((schema.properties![option] as { type: string; default: boolean }).type, "boolean");
    assert.equal((schema.properties![option] as { default: boolean }).default, false);
  }
  for (const [generatePickupDisplacementCsv, generatePickupReactionCsv, dimension] of [
    [true, false, 2], [false, true, 2], [true, true, 3], [false, false, 3],
  ] as const) {
    const result = await client.callTool({ name: "fempython_calculate", arguments: {
      input: JSON.stringify({ dimension }), generatePdf: false, generatePik: false,
      generatePickupDisplacementCsv, generatePickupReactionCsv,
    } });
    assert.equal(result.isError, undefined);
    const manifest = result.structuredContent as {
      jobId: string; summary: Record<string, unknown>;
      artifacts: Array<{ artifactId: string; name: string; mediaType: string; bytes: number; sha256: string }>;
    };
    assert.equal(manifest.summary.generatePickupDisplacementCsv, generatePickupDisplacementCsv);
    assert.equal(manifest.summary.generatePickupReactionCsv, generatePickupReactionCsv);
    assert.deepEqual(manifest.artifacts.map((artifact) => artifact.name), ["result.json",
      ...(generatePickupDisplacementCsv ? ["pickup-displacement.csv"] : []),
      ...(generatePickupReactionCsv ? ["pickup-reaction.csv"] : [])]);
    const job = await client.callTool({ name: "get_job", arguments: { jobId: manifest.jobId } });
    assert.deepEqual((job.structuredContent as { artifacts: unknown[] }).artifacts, manifest.artifacts);
    for (const artifact of manifest.artifacts.filter((item) => item.name.endsWith(".csv"))) {
      assert.equal(artifact.mediaType, "text/csv; charset=utf-8");
      assert.equal(artifact.artifactId, artifact.name.slice(0, -4));
      const chunks: Buffer[] = [];
      let offset = 0;
      while (true) {
        const read = await client.callTool({ name: "read_artifact", arguments: {
          jobId: manifest.jobId, artifactId: artifact.artifactId, offsetBytes: offset, maxBytes: 31,
        } });
        assert.equal(read.isError, undefined);
        const chunk = read.structuredContent as { base64: string; offsetBytes: number; nextOffsetBytes: number; eof: boolean; totalBytes: number };
        const bytes = Buffer.from(chunk.base64, "base64");
        assert.equal(chunk.offsetBytes, offset);
        assert.equal(chunk.totalBytes, artifact.bytes);
        assert.equal(chunk.nextOffsetBytes, offset + bytes.length);
        chunks.push(bytes);
        offset = chunk.nextOffsetBytes;
        if (chunk.eof) break;
        assert.ok(bytes.length > 0 && offset < artifact.bytes);
      }
      const bytes = Buffer.concat(chunks);
      assert.equal(bytes.length, artifact.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
      assert.notEqual(bytes.subarray(0, 3).toString("hex"), "efbbbf");
      const lines = bytes.toString("utf8").trim().split(/\r?\n/);
      assert.equal(lines[0]!.split(",").length, 17);
      assert.match(lines[1]!, /節点1,2,3,0\.00012345678901234567/);
    }
  }
});

test("FrameWeb can add both CSVs alongside the default PIK/PDF outputs", async () => {
  const result = await client.callTool({ name: "fempython_calculate", arguments: {
    input: "{}", generatePickupDisplacementCsv: true, generatePickupReactionCsv: true,
  } });
  assert.equal(result.isError, undefined);
  assert.deepEqual((result.structuredContent as { artifacts: Array<{ name: string }> }).artifacts.map((artifact) => artifact.name),
    ["result.json", "pickup.pik", "report.pdf", "pickup-displacement.csv", "pickup-reaction.csv"]);
});

test("FrameWeb accepts BOM-prefixed UTF-8 JSON from a Windows client", async () => {
  const result = await client.callTool({ name: "fempython_calculate", arguments: { input: '\uFEFF{"dimension":2}' } });
  assert.equal(result.isError, undefined);
  assert.equal((result.structuredContent as { ok: boolean }).ok, true);
});

test("FrameWeb rejects invalid sources and report selections", async () => {
  for (const args of [{}, { input: "{}", inputPath: "unused.json" }, { input: "[]" }, { input: "{" },
    { input: "{}", pdfSections: [] }, { input: "{}", pdfSections: ["unknown"] }, { input: "{}", pdfSections: ["input", "input"] },
    { input: "{}", generatePickupDisplacementCsv: "true" }, { input: "{}", generatePickupReactionCsv: 1 }]) {
    const result = await client.callTool({ name: "fempython_calculate", arguments: args });
    assert.equal(result.isError, true, JSON.stringify(args));
  }
});

test("FrameWeb failures publish no artifacts and missing requested outputs fail closed", async () => {
  const failed = await client.callTool({ name: "fempython_calculate", arguments: { input: '{"simulate":"failure"}' } });
  assert.equal(failed.isError, true);
  assert.deepEqual((failed.structuredContent as { artifacts: unknown[] }).artifacts, []);
  for (const name of ["result.json", "pickup.pik", "report.pdf"]) {
    const missing = await client.callTool({ name: "fempython_calculate", arguments: { input: JSON.stringify({ omit: name }) } });
    assert.equal(missing.isError, true);
    assert.match(JSON.stringify(missing.structuredContent), /required artifact/);
  }
});

test("FrameWeb requires each requested CSV and publishes no artifacts on failure", async () => {
  const flags = { generatePik: false, generatePdf: false, generatePickupDisplacementCsv: true, generatePickupReactionCsv: true };
  for (const name of ["pickup-displacement.csv", "pickup-reaction.csv"]) {
    const result = await client.callTool({ name: "fempython_calculate", arguments: {
      input: JSON.stringify({ omit: name }), ...flags,
    } });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.structuredContent), /required artifact/);
    assert.deepEqual((result.structuredContent as { artifacts?: unknown[] } | undefined)?.artifacts ?? [], []);
  }
  const result = await client.callTool({ name: "fempython_calculate", arguments: {
    input: '{"simulate":"failure"}', ...flags,
  } });
  assert.equal(result.isError, true);
  assert.deepEqual((result.structuredContent as { artifacts: unknown[] }).artifacts, []);
});

test("a missing FrameWeb runner does not disable other engines", async () => {
  const isolated = await connect({ STRUCTURAL_MCP_FEMPYTHON_RUNNER: resolve(jobRoot, "missing-frame.exe") });
  try {
    const caps = await isolated.callTool({ name: "get_capabilities", arguments: {} });
    const engines = (caps.structuredContent as { engines: Record<string, { enabled: boolean }> }).engines;
    assert.equal(engines.fempython?.enabled, false);
    assert.equal(engines.capacita?.enabled, true);
    assert.equal(engines.soilstructure?.enabled, true);
    const result = await isolated.callTool({ name: "fempython_calculate", arguments: { input: "{}" } });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.structuredContent), /fempython_unavailable/);
  } finally { await isolated.close(); }
});
