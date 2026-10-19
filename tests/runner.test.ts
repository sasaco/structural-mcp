import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { runnerInvocation } from "../src/runner.js";

test("a runner is started by its extension; a Python script with the .venv beside it", () => {
  const python = resolve("C:/tools/WebPier/run_headless.py");
  assert.deepEqual(runnerInvocation(python, ["contract"]), {
    executable: resolve("C:/tools/WebPier/.venv/Scripts/python.exe"),
    args: ["-X", "utf8", python, "contract"],
  });
  assert.deepEqual(runnerInvocation("C:/r/Runner.DLL", ["run"]), { executable: "dotnet", args: ["C:/r/Runner.DLL", "run"] });
  assert.deepEqual(runnerInvocation("C:/r/runner.mjs", ["run"]), { executable: process.execPath, args: ["C:/r/runner.mjs", "run"] });
  assert.deepEqual(runnerInvocation("C:/r/runner.exe", ["run"]), { executable: "C:/r/runner.exe", args: ["run"] });
});
