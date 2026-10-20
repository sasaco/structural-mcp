import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = resolve(repositoryRoot, "tests/fixtures");
const fakeRunner = resolve(fixtureRoot, "fake-runner.mjs");
const fakeFemRunner = resolve(fixtureRoot, "fake-fempython-runner.mjs");
const fakeAggreSeRunner = resolve(fixtureRoot, "fake-aggrese-runner.mjs");
const fakeWebPierRunner = resolve(fixtureRoot, "fake-webpier-runner.mjs");
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
      STRUCTURAL_MCP_AGGRESE_RUNNER: fakeAggreSeRunner,
      STRUCTURAL_MCP_WEBPIER_RUNNER: fakeWebPierRunner,
      // WebPier passes on only the runners the server found; JRSNAP is missing unless a test sets it.
      STRUCTURAL_MCP_JRSNAP_RUNNER: resolve(jobRoot, "missing-jrsnap.exe"),
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
    "aggrese_calculate",
    "aggrese_inspect",
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
    "webpier_generate",
    "webpier_get_contract",
    "webpier_get_input_schema",
    "webpier_validate",
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

const aggreSeProject = resolve(fixtureRoot, "aggrese", "model.xml");

async function readResultJson(jobId: string): Promise<Record<string, unknown>> {
  const read = await client.callTool({ name: "read_text_artifact", arguments: { jobId, artifactId: "result-json", maxBytes: 65536 } });
  assert.equal(read.isError, undefined);
  return JSON.parse((read.structuredContent as { text: string }).text) as Record<string, unknown>;
}

/** Shift-JIS bytes of an ASCII-only Aggre-SE XML (ASCII is a subset of Shift-JIS). */
function aggreSeXml(db1Paths: string[], marker = ""): Buffer {
  const strings = db1Paths.map((path) => `      <string>${path.replaceAll("&", "&amp;")}</string>`).join("\n");
  return Buffer.from(`<?xml version="1.0" encoding="utf-16"?>\n<Datas>${marker}\n  <SNAP>\n    <SnapDBPath>\n${strings}\n    </SnapDBPath>\n  </SNAP>\n</Datas>\n`, "ascii");
}

test("stages an Aggre-SE project with its JRSNAP files and returns the selected outputs", async () => {
  const result = await client.callTool({
    name: "aggrese_calculate",
    arguments: { inputPath: aggreSeProject, generateReportPdf: true, generatePik: true },
  });
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
  const structured = result.structuredContent as { jobId: string; engine: string; tool: string; artifacts: Array<{ artifactId: string; relativePath: string }> };
  assert.equal(structured.engine, "aggrese");
  assert.equal(structured.tool, "aggrese_calculate");
  assert.deepEqual(structured.artifacts.map((item) => item.relativePath), [
    "output/result.json",
    "output/summary.xlsx",
    "output/report.pdf",
    "output/cases/case-01.xlsx",
    "output/cases/case-03.xlsx",
    "output/pickup.pik",
  ]);
  const summary = await readResultJson(structured.jobId);
  // Same-name JRSNAP files, the direct-foundation CSV and Aspect-SE CSVs; never Batch's own .xlsx/.csv outputs.
  assert.deepEqual(summary.staged, {
    0: ["Aspect-SE_L2-spc1_G9（RC）.csv", "ケース1(正向&負向).DB1", "ケース1(正向&負向).R10", "ケース1(正向&負向)_Output_Chokukiso.csv"],
    2: ["ケース3.DB1", "ケース3.DB2"],
  });
  assert.deepEqual(summary.flags, {
    "--summary-xlsx": "true", "--report-pdf": "true", "--check-tables": "true", "--pik": "true", "--pile-anchor-bar-pdf": "false",
  });
  const pik = await client.callTool({ name: "read_artifact", arguments: { jobId: structured.jobId, artifactId: "pickup-pik" } });
  assert.equal(Buffer.from((pik.structuredContent as { base64: string }).base64, "base64").toString("ascii"), "Batch ver1.0.0\r\n");
});

test("Aggre-SE check tables follow the report PDF and at least one output is required", async () => {
  const summaryOnly = await client.callTool({ name: "aggrese_calculate", arguments: { inputPath: aggreSeProject } });
  assert.equal(summaryOnly.isError, undefined);
  const summary = await readResultJson((summaryOnly.structuredContent as { jobId: string }).jobId);
  assert.equal((summary.flags as Record<string, string>)["--check-tables"], "false");

  const none = await client.callTool({ name: "aggrese_calculate", arguments: { inputPath: aggreSeProject, generateSummaryExcel: false } });
  assert.equal(none.isError, true);
  assert.match(JSON.stringify(none.structuredContent), /成果物を1つ以上/);
});

test("Aggre-SE inspect passes the user's spectral ductility and rejects unknown cases", async () => {
  const result = await client.callTool({
    name: "aggrese_inspect",
    arguments: { inputPath: aggreSeProject, spectralDuctility: [{ caseNumber: 3, value: 2.5 }] },
  });
  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as { jobId: string; artifacts: Array<{ relativePath: string }> };
  assert.deepEqual(structured.artifacts.map((item) => item.relativePath), ["output/result.json"]);
  const summary = await readResultJson(structured.jobId);
  assert.equal(summary.command, "inspect");
  assert.deepEqual(summary.spectralDuctility, { 2: 2.5 });

  // Case 2 has no DB1 in the fixture.
  const unknown = await client.callTool({
    name: "aggrese_inspect",
    arguments: { inputPath: aggreSeProject, spectralDuctility: [{ caseNumber: 2, value: 2.5 }] },
  });
  assert.equal(unknown.isError, true);
  assert.match(JSON.stringify(unknown.structuredContent), /ケース2にはDB1がありません/);
});

test("Aggre-SE reports a missing spectral ductility and accepts it on the next call", async () => {
  const project = await mkdtemp(resolve(tmpdir(), "structural-mcp-aggrese-"));
  const isolated = await connect({ STRUCTURAL_MCP_ALLOWED_ROOTS: project });
  try {
    await writeFile(resolve(project, "case.DB1"), "fake");
    await writeFile(resolve(project, "model.xml"), aggreSeXml(["case.DB1"], "<!-- FAKE_SPECTRAL -->"));
    const missing = await isolated.callTool({ name: "aggrese_calculate", arguments: { inputPath: resolve(project, "model.xml") } });
    assert.equal(missing.isError, true);
    const failure = missing.structuredContent as { ok: boolean; artifacts: unknown[]; errors: Array<{ code: string }> };
    assert.equal(failure.ok, false);
    assert.deepEqual(failure.artifacts, []);
    assert.equal(failure.errors[0]?.code, "SPECTRAL_DUCTILITY_REQUIRED");

    const given = await isolated.callTool({
      name: "aggrese_calculate",
      arguments: { inputPath: resolve(project, "model.xml"), spectralDuctility: [{ caseNumber: 1, value: 3 }] },
    });
    assert.equal(given.isError, undefined);
  } finally {
    await isolated.close();
    await rm(project, { recursive: true, force: true });
  }
});

test("Aggre-SE DB1 files must be inside the allowed roots", async () => {
  const project = await mkdtemp(resolve(tmpdir(), "structural-mcp-aggrese-"));
  const external = await mkdtemp(resolve(tmpdir(), "structural-mcp-external-"));
  const isolated = await connect({ STRUCTURAL_MCP_ALLOWED_ROOTS: project });
  try {
    await writeFile(resolve(external, "case.DB1"), "fake");
    await writeFile(resolve(project, "absolute.xml"), aggreSeXml([resolve(external, "case.DB1")]));
    await writeFile(resolve(project, "relative.xml"), aggreSeXml([`..\\${basename(external)}\\case.DB1`]));
    await writeFile(resolve(project, "missing.xml"), aggreSeXml(["missing.DB1"]));
    for (const name of ["absolute.xml", "relative.xml"]) {
      const result = await isolated.callTool({ name: "aggrese_inspect", arguments: { inputPath: resolve(project, name) } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.structuredContent), /ケース1のDB1を読み取れません.*outside STRUCTURAL_MCP_ALLOWED_ROOTS/);
    }
    const missing = await isolated.callTool({ name: "aggrese_inspect", arguments: { inputPath: resolve(project, "missing.xml") } });
    assert.equal(missing.isError, true);
    assert.match(JSON.stringify(missing.structuredContent), /ケース1のDB1を読み取れません/);
  } finally {
    await isolated.close();
    await rm(project, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("a missing Aggre-SE runner disables only its tools", async () => {
  const isolated = await connect({ STRUCTURAL_MCP_AGGRESE_RUNNER: resolve(jobRoot, "missing-aggrese.exe") });
  try {
    const caps = await isolated.callTool({ name: "get_capabilities", arguments: {} });
    const engines = (caps.structuredContent as { engines: Record<string, { enabled: boolean; readiness: string }> }).engines;
    assert.equal(engines.aggrese?.enabled, false);
    assert.equal(engines.aggrese?.readiness, "unavailable");
    assert.equal(engines.soilstructure?.enabled, true);
    const result = await isolated.callTool({ name: "aggrese_calculate", arguments: { inputPath: aggreSeProject } });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.structuredContent), /aggrese_unavailable/);
  } finally { await isolated.close(); }
});

const webPierInput = resolve(fixtureRoot, "webpier/pier-input.json");

interface WebPierManifest {
  ok: boolean;
  jobId: string;
  engine: string;
  engineeringStatus: string;
  summary: {
    input: { file: string; sha256: string };
    environment: Record<string, string>;
    environmentKeys: string[];
    stages: Array<{ id: string; stem: string; engineeringStatus: string }>;
    requiredRunners?: Array<{ engine: string; environmentVariable: string; available: boolean }>;
  };
  artifacts: Array<{ artifactId: string; relativePath: string; bytes: number; sha256: string }>;
  errors: Array<{ code: string; path?: string }>;
}

test("the WebPier contract says which stages the detected runners can generate", async () => {
  const result = await client.callTool({ name: "webpier_get_contract", arguments: {} });
  assert.equal(result.isError, undefined);
  const contract = result.structuredContent as {
    runners: Array<{ engine: string; environmentVariable: string; available: boolean }>;
    selections: Array<{ stage: string; frameAnalysis: boolean; nonlinearAnalysis: boolean; available: boolean; missingRunners: string[] }>;
    unavailableStages: string[];
    generationTool: string;
  };
  assert.deepEqual(contract.runners.map(({ engine, available }) => [engine, available]),
    [["fempython", true], ["jrsnap", false], ["webdan2", true], ["aggrese", true]]);
  assert.deepEqual(contract.unavailableStages, ["0711"]);
  const all = contract.selections.filter((selection) => selection.stage === "all");
  assert.deepEqual(all.map((selection) => [selection.frameAnalysis, selection.nonlinearAnalysis, selection.available]),
    [[false, false, true], [true, false, true], [false, true, false], [true, true, false]]);
  assert.deepEqual(contract.selections.find((selection) => selection.stage === "0711")?.missingRunners, ["jrsnap"]);
  assert.equal(contract.generationTool, "webpier_generate");

  const schema = await client.callTool({ name: "webpier_get_input_schema", arguments: {} });
  assert.equal(schema.isError, undefined);
  assert.deepEqual((schema.structuredContent as { inputSchema: { properties: unknown } }).inputSchema.properties,
    { schema_version: { const: 2 } });

  const capabilities = await client.callTool({ name: "get_capabilities", arguments: {} });
  const engines = (capabilities.structuredContent as {
    engines: Record<string, { enabled: boolean; tools: string[]; timeoutMs?: number }>;
  }).engines;
  assert.equal(engines.webpier?.enabled, true);
  assert.equal(engines.webpier?.timeoutMs, 30 * 60_000);
  assert.deepEqual(engines.webpier?.tools,
    ["webpier_get_input_schema", "webpier_get_contract", "webpier_validate", "webpier_generate"]);
  assert.equal(engines.jrsnap?.enabled, false);
  // The skill's placement script reads a job from <jobRoot>/<date>/<jobId> on the same PC.
  const pathPolicy = (capabilities.structuredContent as { pathPolicy: { jobRoot: string } }).pathPolicy;
  assert.equal(pathPolicy.jobRoot, await realpath(jobRoot));
  const template = await client.callTool({ name: "get_environment_template", arguments: { engine: "webpier" } });
  assert.deepEqual((template.structuredContent as { variables: Array<{ name: string; value: string }> }).variables
    .map(({ name, value }) => [name, value]), [["STRUCTURAL_MCP_WEBPIER_RUNNER", fakeWebPierRunner]]);
});

test("WebPier generates a stage from the project's input with only the runners it calls", async () => {
  const result = await client.callTool({ name: "webpier_generate", arguments: { inputPath: webPierInput, stage: "0612" } });
  assert.equal(result.isError, undefined);
  const manifest = result.structuredContent as unknown as WebPierManifest;
  assert.equal(manifest.engine, "webpier");
  assert.equal(manifest.engineeringStatus, "not_ok");
  assert.deepEqual(manifest.summary.stages, [{ id: "0612", stem: "0612_線路方向基礎", engineeringStatus: "not_ok" }]);
  // The input keeps its name and bytes: WebPier records both in its outputs.
  const bytes = await readFile(webPierInput);
  assert.deepEqual(manifest.summary.input,
    { file: "pier-input.json", sha256: createHash("sha256").update(bytes).digest("hex") });
  // The minimal environment and the detected runners WebPier calls; JRSNAP is missing, so it is not passed.
  assert.deepEqual(manifest.summary.environment, {
    STRUCTURAL_MCP_FEMPYTHON_RUNNER: fakeFemRunner,
    STRUCTURAL_MCP_WEBDAN_RUNNER: fakeRunner,
    STRUCTURAL_MCP_AGGRESE_RUNNER: fakeAggreSeRunner,
  });
  // libuv adds the variables Windows needs (USERPROFILE, WINDIR, ...) to every child's environment.
  const windows = ["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "SYSTEMDRIVE", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR"];
  const allowed = new Set(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "DOTNET_ROOT", "TEMP", "TMP", ...windows,
    ...Object.keys(manifest.summary.environment)]);
  assert.deepEqual(manifest.summary.environmentKeys.filter((key) => !allowed.has(key)), []);
  assert.deepEqual(manifest.artifacts.map(({ artifactId, relativePath }) => [artifactId, relativePath]), [
    ["0612-pdf", "output/output/0612_線路方向基礎.pdf"],
    ["0612-json", "output/output/0612_線路方向基礎.json"],
    ["0612-pik", "output/post/線路方向.pik"],
    ["0612-pik-provenance", "output/post/線路方向.pik.provenance.json"],
    ["0612-reaction", "output/post/線路方向_ピックアップ反力.csv"],
    ["0612-reaction-provenance", "output/post/線路方向_ピックアップ反力.csv.provenance.json"],
  ]);
  const pik = manifest.artifacts.find((artifact) => artifact.artifactId === "0612-pik")!;
  const read = await client.callTool({ name: "read_artifact", arguments: { jobId: manifest.jobId, artifactId: pik.artifactId } });
  const content = Buffer.from((read.structuredContent as { base64: string }).base64, "base64");
  assert.equal(createHash("sha256").update(content).digest("hex"), pik.sha256);

  const inline = await client.callTool({ name: "webpier_generate", arguments: { input: bytes.toString("utf8"), stage: "0500" } });
  assert.equal(inline.isError, undefined);
  assert.equal((inline.structuredContent as unknown as WebPierManifest).summary.input.file, "input.json");
});

test("WebPier reports a stage whose runner is missing, and input errors with their path", async () => {
  const missing = await client.callTool({ name: "webpier_generate", arguments: { inputPath: webPierInput, stage: "0711" } });
  assert.equal(missing.isError, true);
  const failed = missing.structuredContent as unknown as WebPierManifest;
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.errors.map((error) => error.code), ["RUNNER_UNAVAILABLE"]);
  assert.deepEqual(failed.artifacts, []);

  const valid = await client.callTool({
    name: "webpier_validate", arguments: { inputPath: webPierInput, stage: "all", nonlinearAnalysis: true },
  });
  assert.equal(valid.isError, undefined);
  assert.deepEqual((valid.structuredContent as unknown as WebPierManifest).summary.requiredRunners, [
    { engine: "fempython", environmentVariable: "STRUCTURAL_MCP_FEMPYTHON_RUNNER", available: true },
    { engine: "jrsnap", environmentVariable: "STRUCTURAL_MCP_JRSNAP_RUNNER", available: false },
    { engine: "aggrese", environmentVariable: "STRUCTURAL_MCP_AGGRESE_RUNNER", available: true },
  ]);

  const wrong = JSON.stringify({ schema_version: 2, 下部構造: { 寸法: { 側面: { B1: -1 } } } });
  const invalid = await client.callTool({ name: "webpier_validate", arguments: { input: wrong } });
  assert.equal(invalid.isError, true);
  assert.deepEqual((invalid.structuredContent as unknown as WebPierManifest).errors.map(({ code, path }) => [code, path]),
    [["INPUT_ERROR", "下部構造.寸法.側面.B1"]]);

  const rejections: Array<[Record<string, unknown>, RegExp]> = [
    [{ inputPath: webPierInput, input: "{}" }, /どちらか一方だけ/],
    [{ input: "[]" }, /JSON object/],
    [{ inputPath: resolve(fixtureRoot, "model.wdj") }, /\.json/],
    [{ inputPath: webPierInput, stage: "--overwrite" }, /stage/],
  ];
  for (const [args, pattern] of rejections) {
    const rejected = await client.callTool({ name: "webpier_generate", arguments: args });
    assert.equal(rejected.isError, true);
    assert.match(JSON.stringify(rejected.structuredContent ?? rejected.content), pattern);
  }
});

test("WebPier passes a load model's add-in inside the allowed roots by its real path (decision 70)", async () => {
  const folder = resolve(fixtureRoot, "webpier");
  const generated = await client.callTool({ name: "webpier_generate", arguments: { inputPath: webPierInput, stage: "0500", addin: folder } });
  assert.equal(generated.isError, undefined);
  assert.equal((generated.structuredContent as unknown as { summary: { addin: string } }).summary.addin, folder);
  const validated = await client.callTool({ name: "webpier_validate", arguments: { inputPath: webPierInput, addin: folder } });
  assert.equal((validated.structuredContent as unknown as { summary: { addin: string } }).summary.addin, folder);
  const plain = await client.callTool({ name: "webpier_validate", arguments: { inputPath: webPierInput } });
  assert.equal((plain.structuredContent as unknown as { summary: { addin: string | null } }).summary.addin, null);
  const contract = await client.callTool({ name: "webpier_get_contract", arguments: { addin: folder } });
  assert.deepEqual((contract.structuredContent as { addin: unknown }).addin,
    { name: "fake-addin", version: "1", contract: 1, folder });
  const schema = await client.callTool({ name: "webpier_get_input_schema", arguments: { addin: folder } });
  assert.equal((schema.structuredContent as { inputSchema: Record<string, unknown> }).inputSchema["x-addin"], folder);
  for (const [addin, pattern] of [[jobRoot, /outside STRUCTURAL_MCP_ALLOWED_ROOTS/], [webPierInput, /not a folder/],
    [resolve(fixtureRoot, "missing-addin"), /ENOENT|no such file/]] as const) {
    for (const name of ["webpier_generate", "webpier_get_contract"]) {
      const rejected = await client.callTool({ name, arguments: name === "webpier_generate" ? { inputPath: webPierInput, addin } : { addin } });
      assert.equal(rejected.isError, true);
      assert.match(JSON.stringify(rejected.structuredContent ?? rejected.content), pattern);
    }
  }
});

test("WebPier lists a JRSNAP folder file by file with distinct artifact IDs", async () => {
  const isolated = await connect({ STRUCTURAL_MCP_JRSNAP_RUNNER: fakeRunner });
  try {
    const result = await isolated.callTool({ name: "webpier_generate", arguments: { inputPath: webPierInput, stage: "0711" } });
    assert.equal(result.isError, undefined);
    const manifest = result.structuredContent as unknown as WebPierManifest;
    assert.deepEqual(manifest.artifacts.filter((artifact) => artifact.relativePath.includes("_JRSNAP/"))
      .map(({ artifactId, relativePath }) => [artifactId, relativePath]), [
      ["0711-jrsnap", "output/post/線路方向_JRSNAP/線路方向(Case1).DB1"],
      ["0711-jrsnap-2", "output/post/線路方向_JRSNAP/線路方向(Case1).ndt"],
    ]);
    assert.equal(manifest.summary.environment.STRUCTURAL_MCP_JRSNAP_RUNNER, fakeRunner);
  } finally { await isolated.close(); }
});

test("a WebPier script without its .venv, or a missing one, disables only the WebPier tools", async () => {
  for (const runner of [resolve(fixtureRoot, "webpier/run_headless.py"), resolve(jobRoot, "missing/run_headless.py")]) {
    const isolated = await connect({ STRUCTURAL_MCP_WEBPIER_RUNNER: runner });
    try {
      const caps = await isolated.callTool({ name: "get_capabilities", arguments: {} });
      const engines = (caps.structuredContent as { engines: Record<string, { enabled: boolean; readiness: string }> }).engines;
      assert.equal(engines.webpier?.enabled, false);
      assert.equal(engines.webpier?.readiness, "unavailable");
      assert.equal(engines.fempython?.enabled, true);
      for (const name of ["webpier_get_contract", "webpier_get_input_schema"]) {
        const result = await isolated.callTool({ name, arguments: {} });
        assert.equal(result.isError, true);
        assert.match(JSON.stringify(result.structuredContent), /webpier_unavailable/);
      }
      const generate = await isolated.callTool({ name: "webpier_generate", arguments: { inputPath: webPierInput } });
      assert.match(JSON.stringify(generate.structuredContent), /webpier_unavailable/);
    } finally { await isolated.close(); }
  }
});
