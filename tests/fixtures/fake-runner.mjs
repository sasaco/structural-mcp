import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const [command, ...rawArgs] = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < rawArgs.length; index += 2) {
  options.set(rawArgs[index], rawArgs[index + 1]);
}
const inputPath = options.get("--input");
const outputDirectory = options.get("--output-dir");
if (!command || !inputPath || !outputDirectory) throw new Error("missing required runner arguments");

const engine = command === "run-rc"
  ? "webdan2"
  : command === "run-steel"
    ? "steeldan"
    : ["run", "export-sdc", "run-ground-displacement"].includes(command)
      ? "soilstructure"
      : null;
if (engine === null) throw new Error(`unsupported command: ${command}`);
if (engine === "webdan2" && !options.has("--output-format")) throw new Error("missing --output-format");
if (["run-steel", "run", "run-ground-displacement"].includes(command) && !options.has("--generate-pdf")) {
  throw new Error("missing --generate-pdf");
}
if (command === "run-ground-displacement" && !options.has("--generate-jot")) throw new Error("missing --generate-jot");

const source = await readFile(inputPath, "utf8");
if (engine === "soilstructure") JSON.parse(source);
await mkdir(outputDirectory, { recursive: true });

const artifacts = [];
async function artifact(kind, name, mediaType, contents) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8");
  await writeFile(resolve(outputDirectory, name), bytes);
  artifacts.push({
    kind,
    mediaType,
    relativePath: name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

await artifact("result", "result.json", "application/json", `${JSON.stringify({ engine, input: basename(inputPath), command })}\n`);
if (command === "export-sdc") {
  await artifact("sdc", "report.sdc", "text/plain; charset=shift_jis", "fake sdc\r\n");
} else if (command === "run-ground-displacement") {
  if (options.get("--generate-pdf") === "true") {
    await artifact("report", "report.pdf", "application/pdf", Buffer.from("%PDF-1.4\n% fake\n"));
  }
  if (options.get("--generate-jot") === "true") {
    await artifact("jot-l1", "ground-displacementL1.JOT", "text/plain; charset=shift_jis", "fake L1\r\n");
    await artifact("jot-l2", "ground-displacementL2.JOT", "text/plain; charset=shift_jis", "fake L2\r\n");
  }
} else if (engine === "webdan2") {
  const outputFormat = options.get("--output-format");
  if (outputFormat === "markdown") await artifact("report", "report.md", "text/markdown", "# Fake Capacita report\n");
  if (outputFormat === "pdf") await artifact("report", "report.pdf", "application/pdf", Buffer.from("%PDF-1.4\n% fake\n"));
} else if (options.get("--generate-pdf") === "true") {
  await artifact("report", "report.pdf", "application/pdf", Buffer.from("%PDF-1.4\n% fake\n"));
}

process.stdout.write(JSON.stringify({
  protocolVersion: 1,
  engine,
  engineVersion: "test-1.0",
  readiness: engine === "steeldan" ? "experimental" : "production",
  ok: true,
  executionStatus: "success",
  engineeringStatus: engine === "steeldan" ? "not_ok" : "ok",
  summary: { fake: true, command },
  messages: [],
  artifacts,
  errors: [],
}));
