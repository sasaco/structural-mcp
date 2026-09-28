import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const requestedInput = process.argv[2];
if (!requestedInput) {
  throw new Error("usage: npm run smoke:soilstructure -- <absolute .json path>");
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
    name: "soilstructure_calculate",
    arguments: { inputPath, generatePdf: true },
  });
  if (result.isError) {
    throw new Error(`SoilStructure MCP smoke failed: ${JSON.stringify(result.structuredContent)}`);
  }

  const value = result.structuredContent;
  const artifacts = Array.isArray(value.artifacts) ? value.artifacts : [];
  const report = artifacts.find((artifact) => artifact.name === "report.pdf");
  const calculation = artifacts.find((artifact) => artifact.name === "result.json");
  if (value.ok !== true || value.engine !== "soilstructure" || !report || !calculation) {
    throw new Error(`Unexpected SoilStructure response: ${JSON.stringify(value)}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: value.ok,
    engine: value.engine,
    jobId: value.jobId,
    artifacts: artifacts.map(({ name, bytes, mediaType }) => ({ name, bytes, mediaType })),
  })}\n`);
} finally {
  await client.close().catch(() => undefined);
  await rm(jobRoot, { recursive: true, force: true });
}
