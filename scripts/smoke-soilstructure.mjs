import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const requestedInput = process.argv[2];
const requestedOperation = process.argv[3] ?? "pile";
if (!requestedInput) {
  throw new Error("usage: npm run smoke:soilstructure -- <absolute .json path> [validate-pile|validate-sdc|validate-ground|pile|sdc|ground]");
}
const operations = {
  "validate-pile": {
    tool: "soilstructure_validate",
    arguments: { operation: "pile" },
    expectedArtifacts: [],
  },
  "validate-sdc": {
    tool: "soilstructure_validate",
    arguments: { operation: "sdc" },
    expectedArtifacts: [],
  },
  "validate-ground": {
    tool: "soilstructure_validate",
    arguments: { operation: "ground" },
    expectedArtifacts: [],
  },
  pile: {
    tool: "soilstructure_calculate",
    arguments: { generatePdf: true },
    expectedArtifacts: ["result.json", "report.pdf"],
  },
  sdc: {
    tool: "soilstructure_export_sdc",
    arguments: {},
    expectedArtifacts: ["result.json", "report.sdc"],
  },
  ground: {
    tool: "soilstructure_ground_displacement",
    arguments: { generatePdf: true, generateJot: true },
    expectedArtifacts: ["result.json", "report.pdf", "ground-displacementL1.JOT", "ground-displacementL2.JOT"],
  },
};
const operation = operations[requestedOperation];
if (!operation) {
  throw new Error("SoilStructure smoke operation must be validate-pile, validate-sdc, validate-ground, pile, sdc, or ground");
}

const inputPath = resolve(requestedInput);
if (!isAbsolute(requestedInput)) {
  throw new Error("SoilStructure smoke input must be an absolute path");
}

const repositoryRoot = resolve(import.meta.dirname, "..");
const jobRoot = await mkdtemp(resolve(tmpdir(), "structural-mcp-soil-smoke-"));
const client = new Client({ name: "structural-mcp-soil-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(repositoryRoot, "dist/src/index.js")],
  env: {
    ...process.env,
    STRUCTURAL_MCP_JOB_ROOT: jobRoot,
    STRUCTURAL_MCP_ALLOWED_ROOTS: dirname(inputPath),
  },
});

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: operation.tool,
    arguments: { inputPath, ...operation.arguments },
  });
  if (result.isError) {
    throw new Error(`SoilStructure MCP smoke failed: ${JSON.stringify(result.structuredContent)}`);
  }

  const value = result.structuredContent;
  const artifacts = Array.isArray(value.artifacts) ? value.artifacts : [];
  const names = new Set(artifacts.map((artifact) => artifact.name));
  if (value.ok !== true || value.engine !== "soilstructure" ||
      operation.expectedArtifacts.some((name) => !names.has(name))) {
    throw new Error(`Unexpected SoilStructure response: ${JSON.stringify(value)}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: value.ok,
    engine: value.engine,
    operation: requestedOperation,
    jobId: value.jobId,
    artifacts: artifacts.map(({ name, bytes, mediaType }) => ({ name, bytes, mediaType })),
  })}\n`);
} finally {
  await client.close().catch(() => undefined);
  await rm(jobRoot, { recursive: true, force: true });
}
