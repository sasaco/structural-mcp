import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const [command, ...rawArgs] = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < rawArgs.length; index += 2) options.set(rawArgs[index], rawArgs[index + 1]);
if (!["inspect", "run"].includes(command)) throw new Error(`unsupported command: ${command}`);
const inputPath = options.get("--input");
const outputDirectory = options.get("--output-dir");
const snapMapPath = options.get("--snap-map");
if (!inputPath || !outputDirectory || !snapMapPath) throw new Error("missing required runner arguments");
const flags = ["--summary-xlsx", "--report-pdf", "--check-tables", "--pik", "--pile-anchor-bar-pdf"];
if (command === "run" && flags.some((flag) => !["true", "false"].includes(options.get(flag)))) throw new Error("missing output flags");

const xml = new TextDecoder("shift_jis").decode(await readFile(inputPath));
if (!xml.includes("<SnapDBPath>")) throw new Error("input is not an Aggre-SE project");
const snapMap = JSON.parse(await readFile(snapMapPath, "utf8"));
const staged = {};
for (const [index, db1] of Object.entries(snapMap)) {
  if (!existsSync(db1)) throw new Error(`staged DB1 is missing: ${db1}`);
  staged[index] = (await readdir(dirname(db1))).sort();
}
const ductility = options.has("--spectral-ductility")
  ? JSON.parse(await readFile(options.get("--spectral-ductility"), "utf8"))
  : {};

function envelope(ok, summary, artifacts, errors) {
  process.stdout.write(JSON.stringify({
    protocolVersion: 1, engine: "aggrese", engineVersion: "test-1.0", readiness: "experimental", ok,
    executionStatus: ok ? "success" : "failed", engineeringStatus: ok ? "not_evaluated" : "not_applicable",
    summary, messages: [], artifacts, errors,
  }));
  process.exitCode = ok ? 0 : 1;
}

const sdr = options.has("--sdr") ? { staged: basename(options.get("--sdr")), directory: basename(dirname(options.get("--sdr"))), direction: options.get("--sdr-direction"), exists: existsSync(options.get("--sdr")), liquefied: options.has("--sdr-liquefied") ? basename(options.get("--sdr-liquefied")) : null } : null;

// The fixture marks a pile foundation with blank limits (no .sdr: an error) and case 1 as a user-defined spectrum case.
if (xml.includes("FAKE_PILE_BLANK") && sdr === null) {
  envelope(false, null, [], [{ category: "input", code: "SDR_REQUIRED", message: "limits are blank", details: {} }]);
} else if (xml.includes("FAKE_SPECTRAL") && ductility["0"] === undefined && command === "run") {
  envelope(false, null, [], [{ category: "input", code: "SPECTRAL_DUCTILITY_REQUIRED", message: "case 1 needs μ", details: { cases: [{ caseNumber: 1, source: "missing" }] } }]);
} else {
  await mkdir(outputDirectory, { recursive: true });
  const artifacts = [];
  async function artifact(kind, name, mediaType, contents) {
    const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8");
    await mkdir(dirname(resolve(outputDirectory, name)), { recursive: true });
    await writeFile(resolve(outputDirectory, name), bytes);
    artifacts.push({ kind, mediaType, relativePath: name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const summary = { command, input: basename(inputPath), staged, spectralDuctility: ductility, sdr, flags: Object.fromEntries(flags.map((flag) => [flag, options.get(flag)])) };
  await artifact("result-json", "result.json", "application/json", `${JSON.stringify(summary)}\n`);
  if (options.get("--summary-xlsx") === "true") await artifact("summary-xlsx", "summary.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from("PK\u0003\u0004fake"));
  if (options.get("--report-pdf") === "true") await artifact("report-pdf", "report.pdf", "application/pdf", Buffer.from("%PDF-1.4\n% fake\n"));
  if (options.get("--check-tables") === "true") {
    for (const index of Object.keys(snapMap)) {
      const number = String(Number(index) + 1).padStart(2, "0");
      await artifact(`case-${number}-check-table-xlsx`, `cases/case-${number}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from("PK\u0003\u0004case"));
    }
  }
  if (options.get("--pik") === "true") await artifact("pickup-pik", "pickup.pik", "text/plain; charset=shift_jis", "Batch ver1.0.0\r\n");
  if (options.get("--pile-anchor-bar-pdf") === "true") await artifact("pile-anchor-bar-pdf", "pile-anchor-bar.pdf", "application/pdf", Buffer.from("%PDF-1.4\n% bar\n"));
  envelope(true, summary, artifacts, []);
}
