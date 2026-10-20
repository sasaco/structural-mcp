// A stand-in for WebPier's run_headless.py (protocol v1): the commands, the envelope, the output/ and post/ layout
// and the error codes of the real runner, with four stages. The summary reports what the runner received: its
// arguments, the input's name and SHA-256, and the environment, so the tests can check what the server passes.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const [command, ...rawArgs] = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < rawArgs.length; index += 2) options.set(rawArgs[index], rawArgs[index + 1]);

const runnerKeys = {
  fempython: "STRUCTURAL_MCP_FEMPYTHON_RUNNER",
  jrsnap: "STRUCTURAL_MCP_JRSNAP_RUNNER",
  webdan2: "STRUCTURAL_MCP_WEBDAN_RUNNER",
  aggrese: "STRUCTURAL_MCP_AGGRESE_RUNNER",
};
// id, stem, runners it calls when chosen alone, engineering status, its post files.
const stages = [
  { id: "0500", stem: "0500_直接基礎", runners: [], status: "not_evaluated", post: [] },
  { id: "0610", stem: "0610_線路方向荷重", runners: ["fempython"], status: "not_evaluated", post: [["frameweb", "線路方向.json"]] },
  { id: "0612", stem: "0612_線路方向基礎", runners: ["fempython"], status: "not_ok", post: [["pik", "線路方向.pik"], ["reaction", "線路方向_ピックアップ反力.csv"]] },
  { id: "0711", stem: "0711_線路方向非線形解析", runners: ["jrsnap", "aggrese"], status: "not_evaluated", post: [["aggrese", "線路方向.xml"]], folder: "線路方向_JRSNAP" },
];

function envelope(ok, summary, { artifacts = [], errors = [], engineeringStatus = "not_evaluated" } = {}) {
  process.stdout.write(JSON.stringify({
    protocolVersion: 1, engine: "webpier", engineVersion: "0.1.0-fake", readiness: "experimental", ok,
    executionStatus: ok ? "success" : "failed", engineeringStatus, summary,
    messages: errors.map((error) => ({ level: "error", code: error.code, text: error.message, path: error.path ?? null })),
    artifacts, errors,
  }));
  process.exitCode = ok ? 0 : 2;
}

function selected(stage, frame, nonlinear) {
  if (stage !== "all") return stages.filter((item) => item.id === stage);
  return stages.filter((item) => (item.id !== "0612" || frame) && (item.id !== "0711" || nonlinear));
}

function runnersOf(chosen) {
  return Object.keys(runnerKeys).filter((engine) => chosen.some((item) => item.runners.includes(engine)));
}

if (command === "contract") {
  const selection = (stage, frameAnalysis, nonlinearAnalysis) => {
    const chosen = selected(stage, frameAnalysis, nonlinearAnalysis);
    return { stage, frameAnalysis, nonlinearAnalysis, stages: chosen.map((item) => item.id), runners: runnersOf(chosen),
      files: chosen.map((item) => ({ role: `${item.id}.pdf`, path: `output/${item.stem}.pdf`, folder: false })) };
  };
  envelope(true, {
    command,
    stages: stages.map(({ id, stem }) => ({ id, stem, dependsOn: [], optIn: [], hasReport: true })),
    switches: [{ name: "frame_analysis", flag: "--frame-analysis", stages: ["0612"] },
      { name: "nonlinear_analysis", flag: "--nonlinear-analysis", stages: ["0711"] }],
    runners: Object.entries(runnerKeys).map(([engine, environmentVariable]) => ({ engine, environmentVariable })),
    selections: [selection("all", false, false), selection("all", true, false), selection("all", false, true),
      selection("all", true, true), ...stages.map((item) => selection(item.id, false, false))],
    ...(options.has("--addin") ? { addin: { name: "fake-addin", version: "1", contract: 1, folder: options.get("--addin") } } : {}),
  });
} else if (command === "schema") {
  envelope(true, { command, schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
    properties: { schema_version: { const: 2 } }, ...(options.has("--addin") ? { "x-addin": options.get("--addin") } : {}) } });
} else if (command === "run" || command === "validate") {
  const inputPath = options.get("--input");
  const outputDirectory = options.get("--output-dir");
  const stage = options.get("--stage");
  const frame = options.get("--frame-analysis") === "true";
  const nonlinear = options.get("--nonlinear-analysis") === "true";
  const bytes = await readFile(inputPath);
  const document = JSON.parse(bytes.toString("utf8"));
  const chosen = selected(stage, frame, nonlinear);
  const summary = {
    command, stage, frameAnalysis: frame, nonlinearAnalysis: nonlinear, addin: options.get("--addin") ?? null,
    input: { file: basename(inputPath), sha256: createHash("sha256").update(bytes).digest("hex") },
    environment: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("STRUCTURAL_MCP_"))),
    environmentKeys: Object.keys(process.env).filter((key) => !/^(?:=|COVERAGE)/.test(key)).sort(),
  };
  const missing = runnersOf(chosen).filter((engine) => !process.env[runnerKeys[engine]]);
  if (document.下部構造?.寸法?.側面?.B1 === -1) {
    envelope(false, summary, { errors: [{ category: "input", code: "INPUT_ERROR", message: "下部構造.寸法.側面.B1: 0より大きい値が必要です", path: "下部構造.寸法.側面.B1" }] });
  } else if (command === "validate") {
    envelope(true, { ...summary, stages: chosen.map((item) => item.id),
      requiredRunners: runnersOf(chosen).map((engine) => ({ engine, environmentVariable: runnerKeys[engine], available: !missing.includes(engine) })) });
  } else if (missing.length > 0) {
    envelope(false, { ...summary, missingRunners: missing.map((engine) => ({ engine, environmentVariable: runnerKeys[engine] })) },
      { errors: [{ category: "engine_unavailable", code: "RUNNER_UNAVAILABLE", message: `この生成に必要な runner がありません: ${missing.join("・")}` }] });
  } else {
    const artifacts = [];
    const write = async (kind, relativePath, mediaType, contents) => {
      const data = Buffer.from(contents, "utf8");
      await mkdir(dirname(resolve(outputDirectory, relativePath)), { recursive: true });
      await writeFile(resolve(outputDirectory, relativePath), data);
      artifacts.push({ kind, mediaType, relativePath, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
    };
    for (const item of chosen) {
      await write(`${item.id}-pdf`, `output/${item.stem}.pdf`, "application/pdf", `%PDF-1.4\n% ${item.id}\n`);
      await write(`${item.id}-json`, `output/${item.stem}.json`, "application/json", `${JSON.stringify({ stage: item.id })}\n`);
      for (const [kind, name] of item.post) {
        await write(`${item.id}-${kind}`, `post/${name}`, "text/plain; charset=utf-8", `${item.id} ${kind}\n`);
        await write(`${item.id}-${kind}-provenance`, `post/${name}.provenance.json`, "application/json", `${JSON.stringify({ file: name })}\n`);
      }
      if (item.folder) {
        for (const name of ["線路方向(Case1).DB1", "線路方向(Case1).ndt"]) {
          await write(`${item.id}-jrsnap`, `post/${item.folder}/${name}`, "application/octet-stream", `JRSNAP ${name}\n`);
        }
      }
    }
    const statuses = chosen.map((item) => item.status);
    const whole = statuses.includes("not_ok") ? "not_ok" : statuses.includes("ok") ? "ok" : "not_evaluated";
    envelope(true, { ...summary, stages: chosen.map((item) => ({ id: item.id, stem: item.stem, engineeringStatus: item.status })),
      engineeringStatus: whole, written: (await readdir(outputDirectory)).sort() }, { artifacts, engineeringStatus: whole });
  }
} else {
  envelope(false, null, { errors: [{ category: "request", code: "INVALID_ARGUMENT", message: `unknown command: ${command}` }] });
}
