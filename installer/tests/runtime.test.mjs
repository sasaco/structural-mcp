import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, copyFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import TOML from "../runtime/node_modules/@iarna/toml/toml.js";
import { updateCodexConfig, updateConfigText, withLock } from "../runtime/codex-config.mjs";
import { createLayout, registrationFor, runAction, runProcess, bootstrapPython, probeMcp, PYTHON_VERSION } from "../runtime/launcher.mjs";

const root = resolve(import.meta.dirname, "../..");
const quiet = () => {};
async function isolated(t) {
  const path = await mkdtemp(resolve(tmpdir(), "structural installer 日本語 "));
  t.after(() => rm(path, { recursive: true, force: true }));
  const layout = createLayout(resolve(path, "install 0.2.0"), {
    codexHome: resolve(path, "isolated codex"), dataRoot: resolve(path, "isolated data"), allowedRoot: resolve(path, "計算 inputs"),
  });
  await mkdir(layout.root, { recursive: true });
  return layout;
}

test("registration round-trips Japanese/spaces/backslashes; preserves unrelated config bytes", async (t) => {
  const layout = await isolated(t);
  await mkdir(resolve(layout.configPath, ".."), { recursive: true });
  const original = '\uFEFF# user comment\r\nmodel = "gpt-5"\r\n\r\n[mcp_servers.structural-mcp-dev]\r\ncommand = \'C:\\日本語 user\\node.exe\' # keep me\r\nargs = ["dev.js"]\r\n';
  await writeFile(layout.configPath, original);
  const result = await updateCodexConfig(layout.configPath, registrationFor(layout), layout);
  assert.equal(result.changed, true);
  const installed = await readFile(layout.configPath, "utf8");
  assert.ok(installed.startsWith(original));
  assert.deepEqual(TOML.parse(installed.slice(1)).mcp_servers["structural-mcp"], registrationFor(layout));
  assert.equal((await updateCodexConfig(layout.configPath, registrationFor(layout), layout)).changed, false);
  await updateCodexConfig(layout.configPath, null, layout, { remove: true });
  assert.equal(await readFile(layout.configPath, "utf8"), original);
});

test("different/unmanaged registration, malformed TOML and embedded markers are preserved", async (t) => {
  const layout = await isolated(t);
  for (const original of [
    '[mcp_servers.structural-mcp]\ncommand="some-other.exe"\n',
    'model = [ not valid\n',
    'note = """\n# BEGIN structural-mcp installer managed registration\n# END structural-mcp installer managed registration\n"""\n',
  ]) {
    await mkdir(resolve(layout.configPath, ".."), { recursive: true });
    await writeFile(layout.configPath, original);
    await assert.rejects(updateCodexConfig(layout.configPath, registrationFor(layout), layout, { replaceExisting: true }));
    assert.equal(await readFile(layout.configPath, "utf8"), original);
  }
});

test("unregister owns exact bundled node + server; older managed registration only changes explicitly", async (t) => {
  const layout = await isolated(t);
  const other = createLayout(resolve(layout.root, "../older install"), { codexHome: resolve(layout.configPath, ".."), dataRoot: layout.dataRoot, allowedRoot: layout.allowedRoot });
  await updateCodexConfig(layout.configPath, registrationFor(other), other);
  const original = await readFile(layout.configPath, "utf8");
  assert.equal((await updateCodexConfig(layout.configPath, null, layout, { remove: true })).changed, false);
  assert.equal(await readFile(layout.configPath, "utf8"), original);
  await assert.rejects(updateCodexConfig(layout.configPath, registrationFor(layout), layout), /different structural-mcp/);
  await updateCodexConfig(layout.configPath, registrationFor(layout), layout, { replaceExisting: true });
  assert.equal(TOML.parse(await readFile(layout.configPath, "utf8")).mcp_servers["structural-mcp"].command, layout.node);
  await updateCodexConfig(layout.configPath, null, layout, { remove: true });
  assert.equal((await updateCodexConfig(layout.configPath, null, layout, { remove: true })).changed, false);
});

test("exclusive lock rejects simultaneous writers and releases after error", async (t) => {
  const layout = await isolated(t);
  let unlocked;
  let locked;
  const entered = new Promise((r) => { locked = r; });
  const release = new Promise((r) => { unlocked = r; });
  const lockPath = `${layout.configPath}.structural-mcp.lock`;
  const held = withLock(lockPath, async () => { locked(); await release; throw new Error("simulated"); });
  await entered;
  await assert.rejects(updateCodexConfig(layout.configPath, registrationFor(layout), layout), /Another setup/);
  unlocked();
  await assert.rejects(held, /simulated/);
  await updateCodexConfig(layout.configPath, registrationFor(layout), layout);
  assert.deepEqual(await readdir(resolve(layout.configPath, "..")), ["config.toml"]);
});

test("unrelated settings inside managed block are never erased", async (t) => {
  const layout = await isolated(t);
  const initial = updateConfigText("[mcp_servers]\n", registrationFor(layout), layout).text;
  assert.doesNotThrow(() => updateConfigText(initial, null, layout, { remove: true }));
  const corrupted = initial.replace("# END structural-mcp", '[unrelated]\nkeep="yes"\n# END structural-mcp');
  assert.throws(() => updateConfigText(corrupted, null, layout, { remove: true }), /unrelated settings/);
});

test("initialization failure writes retry state and never creates or changes Codex registration", async (t) => {
  const layout = await isolated(t);
  const bootstrap = async () => { throw new Error("network unavailable"); };
  await assert.rejects(runAction("register-codex", layout, {}, { log: quiet, bootstrap }), /registration was not changed/);
  await assert.rejects(readFile(layout.configPath), { code: "ENOENT" });
  assert.equal(JSON.parse(await readFile(resolve(layout.root, "initialization-state.json"))).status, "initialization_failed");
  let checked = false;
  await runAction("register-codex", layout, {}, { log: quiet, bootstrap: async () => {}, check: async () => { checked = true; } });
  assert.equal(checked, true);
  const config = await readFile(layout.configPath, "utf8");
  await assert.rejects(runAction("register-codex", layout, {}, { log: quiet, bootstrap }), /network unavailable/);
  assert.equal(await readFile(layout.configPath, "utf8"), config);
});

test("health failure after download does not register", async (t) => {
  const layout = await isolated(t);
  await assert.rejects(runAction("register-codex", layout, {}, { log: quiet, bootstrap: async () => {}, check: async () => { throw new Error("invalid Python import"); } }), /invalid Python import/);
  await assert.rejects(readFile(layout.configPath), { code: "ENOENT" });
});

test("bootstrap pins Python and lock; environment and cache are isolated", async (t) => {
  const layout = await isolated(t);
  await mkdir(layout.frameWeb, { recursive: true });
  let call;
  await bootstrapPython(layout, { log: quiet, execute: async (...args) => { call = args; } });
  assert.equal(call[0], layout.uv);
  assert.deepEqual(call[1], ["sync", "--no-config", "--project", layout.frameWeb, "--locked", "--no-dev", "--managed-python", "--python", PYTHON_VERSION]);
  assert.equal(call[2].env.UV_PROJECT_ENVIRONMENT, resolve(layout.frameWeb, ".venv"));
  assert.equal(call[2].env.UV_PYTHON_INSTALL_DIR, resolve(layout.dataRoot, "python"));
  assert.equal(call[2].env.UV_CACHE_DIR, resolve(layout.dataRoot, "uv-cache"));
  assert.equal(call[2].env.PYTHONHOME, undefined);
});

test("runtime MCP probe imports SDK and calls a real server over stdio", async (t) => {
  const layout = await isolated(t);
  await mkdir(layout.allowedRoot, { recursive: true });
  const registration = registrationFor(layout);
  registration.command = process.execPath;
  registration.args = [resolve(root, "dist/src/index.js")];
  registration.env.STRUCTURAL_MCP_WEBDAN_RUNNER = resolve(root, "tests/fixtures/fake-runner.mjs");
  registration.env.STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER = resolve(root, "tests/fixtures/fake-runner.mjs");
  registration.env.STRUCTURAL_MCP_FEMPYTHON_RUNNER = resolve(root, "tests/fixtures/fake-fempython-runner.mjs");
  registration.env.STRUCTURAL_MCP_AGGRESE_RUNNER = resolve(root, "tests/fixtures/fake-aggrese-runner.mjs");
  const capabilities = await probeMcp(layout, { sdkRoot: resolve(root, "node_modules/@modelcontextprotocol/sdk/dist/esm"), registration });
  assert.equal(capabilities.engines.capacita.enabled, true);
  registration.env.STRUCTURAL_MCP_FEMPYTHON_RUNNER = resolve(layout.root, "missing.exe");
  await assert.rejects(probeMcp(layout, { sdkRoot: resolve(root, "node_modules/@modelcontextprotocol/sdk/dist/esm"), registration }), /engine unavailable: fempython/);
});

test("unregister with no Codex installation is a no-op", async (t) => {
  const layout = await isolated(t);
  const result = await runAction("unregister-codex", layout, {}, { log: quiet });
  assert.equal(result.changed, false);
  await assert.rejects(readdir(resolve(layout.configPath, "..")), { code: "ENOENT" });
});

test("invalid UTF-8 config is preserved without partial update or temporary files", async (t) => {
  const layout = await isolated(t);
  await mkdir(resolve(layout.configPath, ".."), { recursive: true });
  const bytes = Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]);
  await writeFile(layout.configPath, bytes);
  await assert.rejects(updateCodexConfig(layout.configPath, registrationFor(layout), layout), /encoded data/);
  assert.deepEqual(await readFile(layout.configPath), bytes);
  assert.deepEqual(await readdir(resolve(layout.configPath, "..")), ["config.toml"]);
});

test("double-click CMD entry preserves quoted Japanese path arguments and exit code", { skip: process.platform !== "win32" }, async (t) => {
  const layout = await isolated(t);
  await mkdir(dirnameFor(layout.node), { recursive: true });
  await link(process.execPath, layout.node).catch(() => copyFile(process.execPath, layout.node));
  await copyFile(resolve(root, "installer/runtime/setup.cmd"), resolve(layout.root, "setup.cmd"));
  await writeFile(resolve(layout.root, "launcher.mjs"), 'console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 17;\n');
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const command = `& ${quote(resolve(layout.root, "setup.cmd"))} --codex-home ${quote(dirnameFor(layout.configPath))} --data-root ${quote(layout.dataRoot)} --allowed-root ${quote(layout.allowedRoot)}; exit $LASTEXITCODE`;
  const result = await runProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", command], { env: { ...process.env, STRUCTURAL_MCP_NO_PAUSE: "1" }, acceptFailure: true });
  assert.equal(result.code, 17, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), ["register-codex", "--codex-home", dirnameFor(layout.configPath), "--data-root", layout.dataRoot, "--allowed-root", layout.allowedRoot]);
});

function dirnameFor(path) { return resolve(path, ".."); }

test("unregister remembers successful custom Codex home when service environment is different", async (t) => {
  const layout = await isolated(t);
  await runAction("register-codex", layout, {}, { initialize: async () => {}, log: quiet });
  const receipt = resolve(layout.root, "codex-registration-state.json");
  assert.equal(JSON.parse(await readFile(receipt, "utf8")).configPath, layout.configPath);
  const serviceLayout = createLayout(layout.root, { codexHome: resolve(layout.root, "wrong-service-home") });
  const result = await runAction("unregister-codex", serviceLayout, {}, { log: quiet });
  assert.equal(result.changed, true);
  assert.equal(TOML.parse(await readFile(layout.configPath, "utf8")).mcp_servers, undefined);
  await assert.rejects(readFile(serviceLayout.configPath), { code: "ENOENT" });
  await assert.rejects(readFile(receipt), { code: "ENOENT" });
});

test("explicit unregister override wins and leaves a different last-successful receipt", async (t) => {
  const layout = await isolated(t);
  const second = { ...layout, configPath: resolve(layout.root, "second home/config.toml") };
  await runAction("register-codex", layout, {}, { initialize: async () => {}, log: quiet });
  await runAction("register-codex", second, {}, { initialize: async () => {}, log: quiet });
  const receipt = resolve(layout.root, "codex-registration-state.json");
  const saved = await readFile(receipt, "utf8");
  await runAction("unregister-codex", layout, { codexHome: dirnameFor(layout.configPath) }, { log: quiet });
  assert.equal(await readFile(receipt, "utf8"), saved);
  assert.equal(TOML.parse(await readFile(layout.configPath, "utf8")).mcp_servers, undefined);
  assert.ok(TOML.parse(await readFile(second.configPath, "utf8")).mcp_servers["structural-mcp"]);
  await runAction("unregister-codex", layout, {}, { log: quiet });
  assert.equal(TOML.parse(await readFile(second.configPath, "utf8")).mcp_servers, undefined);
});

test("malformed or mismatched receipts fail closed without editing either config", async (t) => {
  const layout = await isolated(t);
  await runAction("register-codex", layout, {}, { initialize: async () => {}, log: quiet });
  const receipt = resolve(layout.root, "codex-registration-state.json");
  const original = await readFile(layout.configPath, "utf8");
  for (const invalid of ["not json", JSON.stringify({ schemaVersion: 1, installRoot: resolve(layout.root, "elsewhere"), configPath: layout.configPath }), JSON.stringify({ schemaVersion: 1, installRoot: layout.root, configPath: "config.toml" })]) {
    await writeFile(receipt, invalid);
    await assert.rejects(runAction("unregister-codex", layout, {}, { log: quiet }), /Invalid Codex registration receipt/);
    assert.equal(await readFile(layout.configPath, "utf8"), original);
    assert.equal(await readFile(receipt, "utf8"), invalid);
  }
});

test("failed registration preserves the prior receipt and config", async (t) => {
  const layout = await isolated(t);
  await runAction("register-codex", layout, {}, { initialize: async () => {}, log: quiet });
  const receipt = resolve(layout.root, "codex-registration-state.json");
  const saved = await readFile(receipt, "utf8");
  const other = { ...layout, configPath: resolve(layout.root, "conflict home/config.toml") };
  await mkdir(dirnameFor(other.configPath), { recursive: true });
  const conflicting = '[mcp_servers.structural-mcp]\ncommand="another.exe"\n';
  await writeFile(other.configPath, conflicting);
  await assert.rejects(runAction("register-codex", other, {}, { initialize: async () => {}, log: quiet }), /different structural-mcp/);
  assert.equal(await readFile(receipt, "utf8"), saved);
  assert.equal(await readFile(other.configPath, "utf8"), conflicting);
});

test("receipt write failure reports that registration succeeded and leaves no temporary receipt", async (t) => {
  const layout = await isolated(t);
  const receipt = resolve(layout.root, "codex-registration-state.json");
  await mkdir(receipt);
  await assert.rejects(runAction("register-codex", layout, {}, { initialize: async () => {}, log: quiet }), /registration was saved.*uninstall receipt could not be saved/);
  assert.ok(TOML.parse(await readFile(layout.configPath, "utf8")).mcp_servers["structural-mcp"]);
  assert.deepEqual(await readdir(layout.root), ["codex-registration-state.json"]);
});

test("saved target cannot remove an unowned registration", async (t) => {
  const layout = await isolated(t);
  await runAction("register-codex", layout, {}, { initialize: async () => {}, log: quiet });
  const changed = '[mcp_servers.structural-mcp]\ncommand="another.exe"\n';
  await writeFile(layout.configPath, changed);
  const result = await runAction("unregister-codex", layout, {}, { log: quiet });
  assert.equal(result.changed, false);
  assert.equal(await readFile(layout.configPath, "utf8"), changed);
  assert.equal(JSON.parse(await readFile(resolve(layout.root, "codex-registration-state.json"), "utf8")).configPath, layout.configPath);
});
