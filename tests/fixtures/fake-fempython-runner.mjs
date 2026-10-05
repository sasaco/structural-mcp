import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [command, ...args] = process.argv.slice(2);
if (command !== "run" || args.length % 2 !== 0) throw new Error("Invalid FrameWeb command");
const options = new Map();
for (let index = 0; index < args.length; index += 2) options.set(args[index], args[index + 1]);
for (const key of ["--input", "--output-dir", "--generate-pdf", "--generate-pik", "--pdf-sections"]) {
  if (!options.has(key)) throw new Error(`Missing ${key}`);
}
const input = JSON.parse(await readFile(options.get("--input"), "utf8"));
const summary = {
  command,
  generatePdf: options.get("--generate-pdf") === "true",
  generatePik: options.get("--generate-pik") === "true",
  pdfSections: options.get("--pdf-sections").split(","),
};
const failed = input.simulate === "failure";
const artifacts = [];
async function artifact(kind, name, mediaType, value) {
  if (input.omit === name) return;
  const bytes = Buffer.from(value, "utf8");
  await writeFile(resolve(options.get("--output-dir"), name), bytes);
  artifacts.push({ kind, mediaType, relativePath: name, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") });
}
if (!failed) {
  await artifact("result", "result.json", "application/json", JSON.stringify(summary));
  if (summary.generatePik) await artifact("pik", "pickup.pik", "text/plain; charset=utf-8", "PickUpNo,着目力,部材No\n    1    M    1\n");
  if (summary.generatePdf) await artifact("report", "report.pdf", "application/pdf", "%PDF-1.4\n% MCP transport fixture\n");
}
process.stdout.write(JSON.stringify({
  protocolVersion: 1, engine: "fempython", engineVersion: "test-1.0", readiness: "experimental",
  ok: !failed, executionStatus: failed ? "failed" : "success", engineeringStatus: "not_checked",
  summary, messages: [], artifacts,
  errors: failed ? [{ category: "input", code: "invalid_model", message: "Test model failed" }] : [],
}));
process.exitCode = failed ? 1 : 0;
