import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const webDanRoot = resolve(repositoryRoot, "../WebDan2");
const jobRoot = await mkdtemp(resolve(tmpdir(), "structural-mcp-smoke-"));
const client = new Client({ name: "structural-mcp-smoke", version: "0.1.0" });

try {
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [resolve(repositoryRoot, "dist/src/index.js")],
    env: {
      ...process.env,
      STRUCTURAL_MCP_WEBDAN_RUNNER: resolve(webDanRoot, "WebDan2.Headless/bin/Release/net8.0/WebDan2.Headless.dll"),
      STRUCTURAL_MCP_JOB_ROOT: jobRoot,
      STRUCTURAL_MCP_ALLOWED_ROOTS: webDanRoot,
      STRUCTURAL_MCP_ENABLE_STEELDAN: "true",
    },
  }));

  const tools = await client.listTools();
  const webdan = await client.callTool({
    name: "webdan_calculate",
    arguments: {
      inputPath: resolve(webDanRoot, "WebDan2Test/TestData/TestFile01_H16Rail_Rec_3D.wdj"),
      outputFormat: "markdown",
    },
  });
  const steeldan = await client.callTool({
    name: "steeldan_calculate",
    arguments: {
      inputPath: resolve(webDanRoot, "SteelDanTest/Fixtures/valid-i.wsj"),
      generatePdf: true,
    },
  });

  console.log(JSON.stringify({
    tools: tools.tools.map((tool) => tool.name),
    webdan: webdan.structuredContent,
    steeldan: steeldan.structuredContent,
  }, null, 2));
} finally {
  await client.close();
  const tempRoot = resolve(tmpdir()) + sep;
  if (!resolve(jobRoot).startsWith(tempRoot)) throw new Error("refusing to clean a smoke directory outside the OS temp root");
  await rm(jobRoot, { recursive: true, force: true });
}
