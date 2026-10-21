// A stand-in for WebPier's run_headless.py (protocol v1): the commands, the envelope, the output/ and post/ layout
// and the error codes of the real runner, with five stages of five of its 出力項目 (WebPier decision 72: the input's
// outputs choose the stages; no argument does). The summary reports what the runner received: its arguments, the
// input's name and SHA-256, and the environment, so the tests can check what the server passes.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const [command, ...rawArgs] = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < rawArgs.length; index += 2) options.set(rawArgs[index], rawArgs[index + 1]);
const known = new Set(["--input", "--output-dir", "--addin"]);
const unknown = [...options.keys()].filter((key) => !known.has(key));

const runnerKeys = {
  fempython: "STRUCTURAL_MCP_FEMPYTHON_RUNNER",
  jrsnap: "STRUCTURAL_MCP_JRSNAP_RUNNER",
  webdan2: "STRUCTURAL_MCP_WEBDAN_RUNNER",
  aggrese: "STRUCTURAL_MCP_AGGRESE_RUNNER",
};
// The 出力項目 and the items each uses, as WebPier's inputs/outputs.py has them.
const items = [
  ["detailing", []], ["ground_model", []], ["reactions", []], ["longitudinal", ["ground_model", "reactions"]],
  ["longitudinal_frame_analysis", ["longitudinal"]], ["transverse", ["ground_model", "reactions"]],
  ["transverse_frame_analysis", ["transverse"]], ["longitudinal_seismic", ["longitudinal"]],
  ["longitudinal_nonlinear_analysis", ["longitudinal_seismic"]], ["transverse_seismic", ["transverse"]],
  ["transverse_nonlinear_analysis", ["transverse_seismic"]],
  ["footing", ["longitudinal_frame_analysis", "transverse_frame_analysis", "longitudinal_nonlinear_analysis",
    "transverse_nonlinear_analysis"]],
  ["cantilever", ["longitudinal_nonlinear_analysis", "transverse_nonlinear_analysis"]],
];
const requires = new Map(items);
// id, stem, its 出力項目, runners it calls, engineering status, its post files.
const stages = [
  { id: "0400", stem: "0400_照査の前提", output: "detailing", runners: [], status: "ok", post: [["dxf", "配筋図.dxf"]] },
  { id: "0500", stem: "0500_直接基礎", output: "ground_model", runners: [], status: "not_evaluated", post: [] },
  { id: "0610", stem: "0610_線路方向荷重", output: "longitudinal", runners: ["fempython"], status: "not_evaluated", post: [["frameweb", "線路方向.json"]] },
  { id: "0612", stem: "0612_線路方向基礎", output: "longitudinal_frame_analysis", runners: ["fempython"], status: "not_ok", post: [["pik", "線路方向.pik"], ["reaction", "線路方向_ピックアップ反力.csv"]] },
  { id: "0711", stem: "0711_線路方向非線形解析", output: "longitudinal_nonlinear_analysis", runners: ["jrsnap", "aggrese"], status: "not_evaluated", post: [["aggrese", "線路方向.xml"]], folder: "線路方向_JRSNAP" },
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

function uses(key) {
  const found = new Set();
  const pending = [...requires.get(key)];
  while (pending.length > 0) {
    const item = pending.pop();
    if (!found.has(item)) { found.add(item); pending.push(...requires.get(item)); }
  }
  return found;
}

function selected(keys) {
  return stages.filter((item) => keys.includes(item.output));
}

function runnersOf(chosen) {
  return Object.keys(runnerKeys).filter((engine) => chosen.some((item) => item.runners.includes(engine)));
}

/** The chosen 出力項目 of the input, or the input error WebPier reports for them. */
function chosenOutputs(document) {
  const outputs = document.outputs;
  if (outputs === undefined) return { error: { message: "入力項目がありません: outputs", path: "outputs" } };
  const keys = items.map(([key]) => key).filter((key) => outputs[key] === true);
  for (const key of keys) {
    const missing = requires.get(key).filter((item) => !keys.includes(item));
    if (missing.length > 0) {
      const named = missing.map((item) => `outputs.${item}`).join("・");
      return { error: { message: `outputs.${key}: ${named} も true が必要です`, path: `outputs.${key}` } };
    }
  }
  if (keys.length === 0) {
    return { error: { message: "outputs: 出力項目が選ばれていません（どれかを true にしてください）", path: "outputs" } };
  }
  return { keys };
}

if (unknown.length > 0) {
  envelope(false, null, { errors: [{ category: "request", code: "INVALID_ARGUMENT", message: `unrecognized arguments: ${unknown.join(" ")}` }] });
} else if (command === "contract") {
  // Choosing an item needs the runners of its stages and of the items it uses, which are chosen with it.
  const output = ([key, used]) => {
    const own = selected([key]);
    return { key, requires: used, stages: own.map((item) => item.id), runners: runnersOf(selected([...uses(key), key])),
      files: own.map((item) => ({ role: `${item.id}.pdf`, path: `output/${item.stem}.pdf`, folder: false })) };
  };
  envelope(true, {
    command,
    stages: stages.map(({ id, stem, output }) => ({ id, stem, dependsOn: [], output, hasReport: true })),
    runners: Object.entries(runnerKeys).map(([engine, environmentVariable]) => ({ engine, environmentVariable })),
    outputs: items.map(output),
    ...(options.has("--addin") ? { addin: { name: "fake-addin", version: "1", contract: 1, folder: options.get("--addin") } } : {}),
  });
} else if (command === "schema") {
  envelope(true, { command, schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
    properties: { schema_version: { const: 2 } }, ...(options.has("--addin") ? { "x-addin": options.get("--addin") } : {}) } });
} else if (command === "run" || command === "validate") {
  const inputPath = options.get("--input");
  const outputDirectory = options.get("--output-dir");
  const bytes = await readFile(inputPath);
  const document = JSON.parse(bytes.toString("utf8"));
  const { keys = [], error } = chosenOutputs(document);
  const chosen = selected(keys);
  const summary = {
    command, ...(error === undefined ? { outputs: keys } : {}), addin: options.get("--addin") ?? null,
    input: { file: basename(inputPath), sha256: createHash("sha256").update(bytes).digest("hex") },
    environment: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("STRUCTURAL_MCP_"))),
    environmentKeys: Object.keys(process.env).filter((key) => !/^(?:=|COVERAGE)/.test(key)).sort(),
  };
  const missing = runnersOf(chosen).filter((engine) => !process.env[runnerKeys[engine]]);
  if (error !== undefined) {
    envelope(false, summary, { errors: [{ category: "input", code: "INPUT_ERROR", ...error }] });
  } else if (document.下部構造?.寸法?.側面?.B1 === -1) {
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
