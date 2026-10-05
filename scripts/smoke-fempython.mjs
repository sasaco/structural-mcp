// A real MCP client: all model I/O and final artifact I/O belong to the client.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.argv[2]) throw new Error("usage: npm run smoke:fempython -- <input.json> [new client output directory]");
const repositoryRoot = resolve(import.meta.dirname, "..");
const inputPath = resolve(process.argv[2]);
const input = await readFile(inputPath, "utf8");
const scratch = resolve(repositoryRoot, ".structural-mcp");
await mkdir(scratch, { recursive: true });
const jobRoot = await mkdtemp(resolve(scratch, "frame-smoke-"));
const outputDirectory = process.argv[3] ? resolve(process.argv[3]) : resolve(jobRoot, "client-output");
// Require a new directory so validation never overwrites existing client results.
await mkdir(outputDirectory);
const client = new Client({ name: "structural-mcp-frame-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(repositoryRoot, "dist/src/index.js")],
  env: {
    ...process.env,
    STRUCTURAL_MCP_JOB_ROOT: jobRoot,
    // Deliberately exclude an external client folder: the model is passed inline.
    STRUCTURAL_MCP_ALLOWED_ROOTS: repositoryRoot,
  },
});

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 240_000 });
  if (result.isError || !result.structuredContent) {
    throw new Error(`${name} failed: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  }
  return result.structuredContent;
}

try {
  await client.connect(transport);
  const capabilities = await call("get_capabilities");
  if (!capabilities.engines.fempython.enabled) throw new Error("Build/configure the FrameWebforCS headless runner first");
  const manifest = await call("fempython_calculate", {
    input, generatePdf: true, generatePik: true,
    pdfSections: ["input", "section_force", "pickup_section_force", "displacement", "pickup_displacement"],
  });
  if (!manifest.ok || manifest.engine !== "fempython" || manifest.executionStatus !== "success") {
    throw new Error("Unexpected calculation status");
  }
  const expected = new Set(["result.json", "pickup.pik", "report.pdf"]);
  const downloads = [];
  for (const artifact of manifest.artifacts) {
    if (!expected.delete(artifact.name)) throw new Error("Unexpected/duplicate artifact name");
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
      if (bytes.length === 0 || offset >= artifact.bytes) throw new Error("Artifact read made no progress");
    }
    const contents = Buffer.concat(chunks);
    if (contents.length !== artifact.bytes || createHash("sha256").update(contents).digest("hex") !== artifact.sha256) {
      throw new Error(`Artifact integrity mismatch: ${artifact.name}`);
    }
    if (artifact.name === "report.pdf" && contents.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Invalid PDF");
    if (artifact.name === "pickup.pik" && contents.toString("utf8").trim().split(/\r?\n/).length < 2) throw new Error("Empty PIK");
    if (artifact.name === "result.json") JSON.parse(contents.toString("utf8"));
    downloads.push({ name: artifact.name, contents });
  }
  if (expected.size) throw new Error(`Missing artifacts: ${[...expected].join(", ")}`);
  // Publish only once every requested download has passed validation.
  for (const { name, contents } of downloads) await writeFile(resolve(outputDirectory, name), contents, { flag: "wx" });
  await writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    ok: true, jobId: manifest.jobId, outputDirectory,
    engineeringStatus: manifest.engineeringStatus, summary: manifest.summary,
    artifacts: manifest.artifacts.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
  })}\n`);
} finally { await client.close(); }
