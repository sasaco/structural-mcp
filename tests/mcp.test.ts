import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const webDanRoot = resolve(repositoryRoot, "../WebDan2");
let jobRoot: string;
let client: Client;

before(async () => {
  jobRoot = await mkdtemp(resolve(tmpdir(), "structural-mcp-test-"));
  client = new Client({ name: "structural-mcp-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(repositoryRoot, "dist/src/index.js")],
    env: {
      ...process.env,
      STRUCTURAL_MCP_WEBDAN_RUNNER: resolve(webDanRoot, "WebDan2.Headless/bin/Release/net8.0/WebDan2.Headless.dll"),
      STRUCTURAL_MCP_JOB_ROOT: jobRoot,
      STRUCTURAL_MCP_ALLOWED_ROOTS: webDanRoot,
      STRUCTURAL_MCP_ENABLE_STEELDAN: "true",
    },
  });
  await client.connect(transport);
});

after(async () => {
  await client.close();
  await rm(jobRoot, { recursive: true, force: true });
});

test("lists the five initial tools", async () => {
  const result = await client.listTools();
  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), [
    "get_capabilities",
    "get_job",
    "read_text_artifact",
    "steeldan_calculate",
    "webdan_calculate",
  ]);
  const capabilities = await client.callTool({ name: "get_capabilities", arguments: {} });
  assert.equal(capabilities.isError, undefined);
  const engines = (capabilities.structuredContent as { engines: { webdan2: { enabled: boolean }; steeldan: { enabled: boolean; readiness: string } } }).engines;
  assert.equal(engines.webdan2.enabled, true);
  assert.equal(engines.steeldan.enabled, true);
  assert.equal(engines.steeldan.readiness, "experimental");
});

test("calls WebDan2 through MCP and reads its result artifact", async () => {
  const result = await client.callTool({
    name: "webdan_calculate",
    arguments: {
      inputPath: resolve(webDanRoot, "WebDan2Test/TestData/TestFile01_H16Rail_Rec_3D.wdj"),
      outputFormat: "markdown",
    },
  });
  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as { jobId: string; ok: boolean; artifacts: Array<{ artifactId: string; name: string }> };
  assert.equal(structured.ok, true);
  assert.ok(structured.artifacts.some((item) => item.name === "report.md"));
  const job = await client.callTool({ name: "get_job", arguments: { jobId: structured.jobId } });
  assert.equal(job.isError, undefined);
  assert.equal((job.structuredContent as { jobId: string }).jobId, structured.jobId);
  const read = await client.callTool({ name: "read_text_artifact", arguments: { jobId: structured.jobId, artifactId: "result", maxBytes: 4096 } });
  assert.equal(read.isError, undefined);
  assert.match((read.structuredContent as { text: string }).text, /"returnCode": "OK"/);
});

test("calls experimental SteelDan through MCP", async () => {
  const result = await client.callTool({
    name: "steeldan_calculate",
    arguments: {
      inputPath: resolve(webDanRoot, "SteelDanTest/Fixtures/valid-i.wsj"),
      generatePdf: true,
    },
  });
  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as { ok: boolean; readiness: string; engineeringStatus: string; artifacts: Array<{ name: string }> };
  assert.equal(structured.ok, true);
  assert.equal(structured.readiness, "experimental");
  assert.equal(structured.engineeringStatus, "not_ok");
  assert.ok(structured.artifacts.some((item) => item.name === "result.json"));
  assert.ok(structured.artifacts.some((item) => item.name === "report.pdf"));
});

test("rejects an input path outside allowed roots", async () => {
  const external = await mkdtemp(resolve(tmpdir(), "structural-mcp-external-"));
  try {
    const path = resolve(external, "model.wsj");
    await writeFile(path, await readFile(resolve(webDanRoot, "SteelDanTest/Fixtures/valid-i.wsj")));
    const result = await client.callTool({ name: "steeldan_calculate", arguments: { inputPath: path } });
    assert.equal(result.isError, true);
  } finally {
    await rm(external, { recursive: true, force: true });
  }
});
