import { spawn } from "node:child_process";
import { mkdir, writeFile, realpath, lstat, readFile, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve, dirname, relative, isAbsolute, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { updateCodexConfig, withLock } from "./codex-config.mjs";

export const PYTHON_VERSION = "3.12.12";
const requiredTools = ["get_capabilities", "webdan_calculate", "fempython_calculate", "soilstructure_calculate"];
const registrationStateName = "codex-registration-state.json";
const samePath = (left, right) => resolve(left).toLowerCase() === resolve(right).toLowerCase();

export function createLayout(installRoot, options = {}, environment = process.env) {
  const root = resolve(installRoot);
  const dataRoot = resolve(options.dataRoot ?? resolve(environment.LOCALAPPDATA ?? resolve(homedir(), "AppData/Local"), "structural-mcp"));
  const frameWeb = resolve(root, "engines/FEMPython/FrameWeb");
  return {
    root, dataRoot, frameWeb,
    node: resolve(root, "runtime/node/node.exe"),
    uv: resolve(root, "runtime/uv/uv.exe"),
    server: resolve(root, "server/dist/src/index.js"),
    python: resolve(frameWeb, ".venv/Scripts/python.exe"),
    allowedRoot: resolve(options.allowedRoot ?? resolve(homedir(), "Documents/structural-mcp")),
    configPath: resolve(options.codexHome ?? environment.CODEX_HOME ?? resolve(homedir(), ".codex"), "config.toml"),
    runners: {
      capacita: resolve(root, "engines/Capacita/WebDanforCS.Headless.exe"),
      soilstructure: resolve(root, "engines/SoilStructure/SoilStructure.Headless.exe"),
      fempython: resolve(root, "engines/FEMPython/FrameWebforCS/Headless/FrameWebforCS.Headless.exe"),
    },
  };
}

export function registrationFor(layout) {
  return {
    command: layout.node, args: [layout.server], cwd: layout.root,
    startup_timeout_sec: 60, tool_timeout_sec: 300,
    env: {
      STRUCTURAL_MCP_WEBDAN_RUNNER: layout.runners.capacita,
      STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER: layout.runners.soilstructure,
      STRUCTURAL_MCP_FEMPYTHON_RUNNER: layout.runners.fempython,
      STRUCTURAL_MCP_JOB_ROOT: resolve(layout.dataRoot, "jobs"),
      STRUCTURAL_MCP_ALLOWED_ROOTS: layout.allowedRoot,
      STRUCTURAL_MCP_ENABLE_STEELDAN: "true",
      STRUCTURAL_MCP_TIMEOUT_MS: "240000",
    },
  };
}

export async function runProcess(command, args, { cwd, env = process.env, visible = false, acceptFailure = false, timeout = 300_000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: visible ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", failure;
    const timer = setTimeout(() => { failure = new Error(`Command timed out: ${command}`); child.kill(); }, timeout);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 4 * 1024 * 1024) { failure = new Error("Diagnostic output exceeded 4 MiB."); child.kill(); }
    });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-32_768); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0 && !acceptFailure) return reject(new Error(`Command failed (exit ${code}): ${command}\n${stderr}`));
      resolveResult({ code, stdout, stderr });
    });
  });
}

async function prepareDirectories(layout) {
  await mkdir(layout.dataRoot, { recursive: true });
  await mkdir(layout.allowedRoot, { recursive: true });
  await mkdir(resolve(layout.dataRoot, "jobs"), { recursive: true });
}

async function ensureProjectInsideInstall(layout) {
  const install = await realpath(layout.root);
  const project = await realpath(layout.frameWeb);
  const rel = relative(install, project);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Python project must be inside this installation.");
  try {
    if ((await lstat(resolve(project, ".venv"))).isSymbolicLink()) throw new Error("Refusing to initialize a redirected .venv directory.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}

export async function bootstrapPython(layout, { log = console.log, execute = runProcess } = {}) {
  await ensureProjectInsideInstall(layout);
  log(`Python ${PYTHON_VERSION} and locked packages will be downloaded from the uv-managed Python releases / Python package index.`);
  log(`Python environment: ${resolve(layout.frameWeb, ".venv")}`);
  log(`Downloads/cache: ${layout.dataRoot}`);
  const env = {
    ...process.env,
    UV_PROJECT_ENVIRONMENT: resolve(layout.frameWeb, ".venv"),
    UV_PYTHON_INSTALL_DIR: resolve(layout.dataRoot, "python"),
    UV_CACHE_DIR: resolve(layout.dataRoot, "uv-cache"),
    UV_PYTHON_DOWNLOADS: "automatic",
    UV_LINK_MODE: "copy",
  };
  delete env.VIRTUAL_ENV;
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  await execute(layout.uv, ["sync", "--no-config", "--project", layout.frameWeb, "--locked", "--no-dev", "--managed-python", "--python", PYTHON_VERSION], {
    cwd: layout.frameWeb, env, visible: true, timeout: 30 * 60_000,
  });
}

export async function probePython(layout, execute = runProcess) {
  const env = { ...process.env };
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  const probe = `import sys; assert sys.version_info[:3] == (${PYTHON_VERSION.split(".").join(",")}), sys.version; import fem, numpy, scipy, flask; print(sys.version)`;
  const result = await execute(layout.python, ["-I", "-c", probe], { cwd: layout.frameWeb, env });
  return result.stdout.trim();
}

export async function probeMcp(layout, { sdkRoot = resolve(layout.root, "server/node_modules/@modelcontextprotocol/sdk/dist/esm"), registration = registrationFor(layout) } = {}) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(resolve(sdkRoot, "client/index.js")).href),
    import(pathToFileURL(resolve(sdkRoot, "client/stdio.js")).href),
  ]);
  const transport = new StdioClientTransport({ command: registration.command, args: registration.args, cwd: registration.cwd, env: { ...process.env, ...registration.env }, stderr: "pipe" });
  const client = new Client({ name: "structural-mcp-installer-health", version: "0.2.0" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-8192); });
  try {
    await client.connect(transport, { timeout: 60_000 });
    const listed = await client.listTools({}, { timeout: 60_000 });
    for (const tool of requiredTools) if (!listed.tools.some((entry) => entry.name === tool)) throw new Error(`MCP tool is missing: ${tool}`);
    const result = await client.callTool({ name: "get_capabilities", arguments: {} }, undefined, { timeout: 60_000 });
    if (result.isError) throw new Error("MCP get_capabilities returned an error.");
    const capabilities = result.structuredContent ?? JSON.parse(result.content.find((entry) => entry.type === "text").text);
    for (const engine of ["capacita", "soilstructure", "fempython"]) {
      if (!capabilities.engines?.[engine]?.enabled) throw new Error(`MCP engine unavailable: ${engine}`);
    }
    return capabilities;
  } catch (error) {
    throw new Error(`MCP health check failed: ${error.message}${stderr ? `\n${stderr}` : ""}`);
  } finally { await client.close(); await transport.close(); }
}

export async function health(layout, { log = console.log, execute = runProcess } = {}) {
  await prepareDirectories(layout);
  log("Checking Python imports and .NET runners...");
  const pythonVersion = await probePython(layout, execute);
  for (const [name, runner] of Object.entries(layout.runners)) {
    const result = await execute(runner, name === "capacita" ? ["capabilities"] : [], { cwd: layout.root, acceptFailure: true });
    let envelope;
    try { envelope = JSON.parse(result.stdout.replace(/^\uFEFF/, "")); } catch { throw new Error(`${name} runner did not return protocol JSON. ${result.stderr}`); }
    const engine = name === "capacita" ? "webdan2" : name;
    if (envelope.protocolVersion !== 1 || envelope.engine !== engine || !Array.isArray(envelope.errors)) throw new Error(`${name} runner failed its protocol check.`);
    if (name === "capacita" && (result.code !== 0 || !envelope.ok)) throw new Error("Capacita capabilities probe failed.");
    if (envelope.errors.some((entry) => /internal|execution_failed/i.test(`${entry.category} ${entry.code}`))) throw new Error(`${name} runner reported an internal error.`);
  }
  log("Connecting to MCP and calling get_capabilities...");
  const capabilities = await probeMcp(layout);
  log(`Health check succeeded. Python: ${pythonVersion.split("\n")[0]}`);
  return capabilities;
}

export async function initialize(layout, { log = console.log, bootstrap = bootstrapPython, check = health } = {}) {
  return withLock(resolve(layout.root, ".initialization.lock"), async () => {
    await prepareDirectories(layout);
    try {
      await bootstrap(layout, { log });
      const capabilities = await check(layout, { log });
      await writeFile(resolve(layout.root, "initialization-state.json"), JSON.stringify({ status: "ready", python: PYTHON_VERSION, checkedAt: new Date().toISOString() }, null, 2) + "\n");
      return capabilities;
    } catch (error) {
      await writeFile(resolve(layout.root, "initialization-state.json"), JSON.stringify({ status: "initialization_failed", checkedAt: new Date().toISOString(), error: error.message }, null, 2) + "\n").catch(() => {});
      throw new Error(`Initialization failed; Codex registration was not changed. Check network/proxy access and run setup again.\n${error.message}`);
    }
  });
}

async function readRegistrationState(layout) {
  const statePath = resolve(layout.root, registrationStateName);
  try {
    const stat = await lstat(statePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw new Error("Receipt must be a regular file no larger than 64 KiB.");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (state.schemaVersion !== 1 || typeof state.installRoot !== "string" || !isAbsolute(state.installRoot) ||
        !samePath(state.installRoot, layout.root) || typeof state.configPath !== "string" ||
        !isAbsolute(state.configPath) || basename(state.configPath).toLowerCase() !== "config.toml") {
      throw new Error("Receipt version, installation root or config path is invalid.");
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Invalid Codex registration receipt; no configuration was changed: ${statePath}\n${error.message}`);
  }
}

async function saveRegistrationState(layout) {
  const statePath = resolve(layout.root, registrationStateName);
  const temporary = `${statePath}.${randomUUID()}.tmp`;
  const state = { schemaVersion: 1, installRoot: layout.root, configPath: layout.configPath };
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(state, null, 2) + "\n", "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    // Replacing the entry itself never follows a pre-existing receipt symlink.
    await rename(temporary, statePath);
  } catch (error) {
    throw new Error(`Codex registration was saved at ${layout.configPath}, but its uninstall receipt could not be saved. Re-run setup, or unregister with --codex-home "${dirname(layout.configPath)}".\n${error.message}`);
  } finally { await rm(temporary, { force: true }); }
}

async function registerCodex(layout, options) {
  return withLock(resolve(layout.root, ".codex-registration.lock"), async () => {
    const result = await updateCodexConfig(layout.configPath, registrationFor(layout), layout, options);
    await saveRegistrationState(layout);
    return result;
  });
}

async function unregisterCodex(layout, options) {
  return withLock(resolve(layout.root, ".codex-registration.lock"), async () => {
    const state = await readRegistrationState(layout);
    const configPath = options.codexHome ? resolve(options.codexHome, "config.toml") : state?.configPath ?? layout.configPath;
    const result = await updateCodexConfig(configPath, null, layout, { remove: true });
    if (result.changed && state && samePath(state.configPath, configPath)) {
      await rm(resolve(layout.root, registrationStateName));
    }
    return result;
  });
}

export async function runAction(action, layout, options = {}, dependencies = {}) {
  const log = dependencies.log ?? console.log;
  if (action === "initialize") return (dependencies.initialize ?? initialize)(layout, dependencies);
  if (action === "health") return (dependencies.health ?? health)(layout, dependencies);
  if (action === "register-codex") {
    await (dependencies.initialize ?? initialize)(layout, dependencies);
    const result = await registerCodex(layout, options);
    log(`${result.reason}\nConfig: ${layout.configPath}\nInput folder: ${layout.allowedRoot}\nRestart Codex and open a new conversation to use structural-mcp.`);
    return result;
  }
  if (action === "unregister-codex") {
    const result = await unregisterCodex(layout, options);
    log(result.reason);
    return result;
  }
  throw new Error(`Unknown action: ${action}`);
}

function parseArguments(args) {
  const action = args.shift() ?? "register-codex";
  const options = {};
  const names = { "--codex-home": "codexHome", "--data-root": "dataRoot", "--allowed-root": "allowedRoot" };
  while (args.length) {
    const flag = args.shift();
    if (flag === "--replace-existing") { options.replaceExisting = true; continue; }
    if (flag === "--quiet") { options.quiet = true; continue; }
    if (!names[flag] || !args[0] || !isAbsolute(args[0])) throw new Error(`Expected an absolute path for ${flag}; supported flags: --codex-home, --data-root, --allowed-root, --replace-existing.`);
    options[names[flag]] = args.shift();
  }
  return { action, options };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { action, options } = parseArguments(process.argv.slice(2));
    const layout = createLayout(dirname(fileURLToPath(import.meta.url)), options);
    const log = options.quiet ? () => {} : console.log;
    log(`structural-mcp: ${action}\nInstallation: ${layout.root}`);
    await runAction(action, layout, options, { log });
    log("SUCCESS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
