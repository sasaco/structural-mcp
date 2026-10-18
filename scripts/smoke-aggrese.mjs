// A real MCP client for Aggre-SE (Batch): inspect, run the requested outputs, and download every artifact.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const outputKinds = ["summary", "report", "pik", "pile"];
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  outputs: { type: "string", default: "summary,report" },
  "allowed-root": { type: "string" },
  "spectral-ductility": { type: "string", default: "" },
} });
const outputs = values.outputs.split(",").filter(Boolean);
if (positionals.length !== 1 || !isAbsolute(positionals[0]) || outputs.length === 0 || outputs.some((kind) => !outputKinds.includes(kind))) {
  throw new Error("usage: npm run smoke:aggrese -- <absolute project .xml> [--outputs summary,report,pik,pile] [--allowed-root <dir with the DB1 files>] [--spectral-ductility 1=2.5,3=2]");
}
const inputPath = resolve(positionals[0]);
const spectralDuctility = values["spectral-ductility"].split(",").filter(Boolean).map((pair) => {
  const [caseNumber, value] = pair.split("=").map(Number);
  return { caseNumber, value };
});
const repositoryRoot = resolve(import.meta.dirname, "..");
const scratch = resolve(repositoryRoot, ".structural-mcp");
await mkdir(scratch, { recursive: true });
const jobRoot = await mkdtemp(resolve(scratch, "aggrese-smoke-"));
const outputDirectory = resolve(jobRoot, "client-output");
await mkdir(outputDirectory);
const client = new Client({ name: "structural-mcp-aggrese-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(repositoryRoot, "dist/src/index.js")],
  env: {
    ...process.env,
    STRUCTURAL_MCP_JOB_ROOT: jobRoot,
    STRUCTURAL_MCP_ALLOWED_ROOTS: values["allowed-root"] ? resolve(values["allowed-root"]) : dirname(inputPath),
    // Report PDFs of large models take minutes.
    STRUCTURAL_MCP_TIMEOUT_MS: process.env.STRUCTURAL_MCP_TIMEOUT_MS ?? "600000",
  },
});

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 660_000 });
  if (result.isError || !result.structuredContent) {
    throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  }
  return result.structuredContent;
}

async function download(manifest, artifact) {
  const chunks = [];
  let offset = 0;
  while (true) {
    const value = await call("read_artifact", { jobId: manifest.jobId, artifactId: artifact.artifactId, offsetBytes: offset });
    const bytes = Buffer.from(value.base64, "base64");
    if (value.offsetBytes !== offset || value.nextOffsetBytes !== offset + bytes.length || value.totalBytes !== artifact.bytes) {
      throw new Error("Artifact chunk metadata mismatch");
    }
    chunks.push(bytes);
    offset = value.nextOffsetBytes;
    if (value.eof) break;
    if (bytes.length === 0) throw new Error("Artifact read made no progress");
  }
  const contents = Buffer.concat(chunks);
  if (contents.length !== artifact.bytes || createHash("sha256").update(contents).digest("hex") !== artifact.sha256) {
    throw new Error(`Artifact integrity mismatch: ${artifact.relativePath}`);
  }
  return contents;
}

try {
  await client.connect(transport);
  const capabilities = await call("get_capabilities");
  if (!capabilities.engines.aggrese.enabled) throw new Error("Build/configure the Aggre-SE headless runner first");
  const inspect = await call("aggrese_inspect", { inputPath, ...(spectralDuctility.length ? { spectralDuctility } : {}) });
  const missing = inspect.summary.spectralDuctility.filter((item) => item.source === "missing");
  if (missing.length) throw new Error(`Pass --spectral-ductility for cases: ${missing.map((item) => item.caseNumber).join(", ")}`);
  const started = Date.now();
  const manifest = await call("aggrese_calculate", {
    inputPath,
    generateSummaryExcel: outputs.includes("summary"),
    generateReportPdf: outputs.includes("report"),
    includeCheckTables: true,
    generatePik: outputs.includes("pik"),
    generatePileAnchorBarPdf: outputs.includes("pile"),
    ...(spectralDuctility.length ? { spectralDuctility } : {}),
  });
  if (!manifest.ok || manifest.engine !== "aggrese" || manifest.executionStatus !== "success") throw new Error("Unexpected calculation status");
  const downloads = [];
  for (const artifact of manifest.artifacts) {
    const contents = await download(manifest, artifact);
    if (artifact.mediaType === "application/pdf" && contents.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error(`Invalid PDF: ${artifact.relativePath}`);
    if (artifact.mediaType.includes("spreadsheetml") && contents.subarray(0, 2).toString("ascii") !== "PK") throw new Error(`Invalid xlsx: ${artifact.relativePath}`);
    if (artifact.relativePath === "output/result.json") JSON.parse(contents.toString("utf8"));
    downloads.push({ path: artifact.relativePath.replace(/^output\//, ""), contents });
  }
  for (const { path, contents } of downloads) {
    await mkdir(dirname(resolve(outputDirectory, path)), { recursive: true });
    await writeFile(resolve(outputDirectory, path), contents, { flag: "wx" });
  }
  process.stdout.write(`${JSON.stringify({
    ok: true, jobId: manifest.jobId, seconds: Math.round((Date.now() - started) / 1000), outputDirectory,
    cases: manifest.summary.cases, warnings: manifest.summary.warnings,
    artifacts: manifest.artifacts.map(({ relativePath, bytes }) => ({ relativePath, bytes })),
  })}\n`);
} finally { await client.close(); }
