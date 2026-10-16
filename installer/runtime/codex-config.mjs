import { open, readFile, mkdir, rename, rm, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import TOML from "@iarna/toml";

const NAME = "structural-mcp";
const BEGIN = "# BEGIN structural-mcp installer managed registration";
const END = "# END structural-mcp installer managed registration";
const decode = (bytes) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
const parse = (text) => TOML.parse(text.replace(/^\uFEFF/, ""));
const samePath = (left, right) => typeof left === "string" && resolve(left).toLowerCase() === resolve(right).toLowerCase();

export async function withLock(lockPath, work) {
  await mkdir(dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Another setup may be running. Close it and retry. If it has stopped, remove the stale lock: ${lockPath}`);
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    return await work();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

async function existingBytes(path) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing to replace a symbolic-link configuration: ${path}`);
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function withoutRegistration(parsed) {
  const copy = structuredClone(parsed);
  if (copy.mcp_servers) {
    delete copy.mcp_servers[NAME];
    if (Object.keys(copy.mcp_servers).length === 0) delete copy.mcp_servers;
  }
  return copy;
}

function managedRange(text, parsed) {
  const starts = [...text.matchAll(/^# BEGIN structural-mcp installer managed registration\r?$/gm)];
  const ends = [...text.matchAll(/^# END structural-mcp installer managed registration\r?$/gm)];
  if (starts.length === 0 && ends.length === 0) return null;
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index) {
    throw new Error("Installer registration markers are ambiguous. Configuration was not changed.");
  }
  const start = starts[0].index;
  const end = ends[0].index + ends[0][0].length + (text[ends[0].index + ends[0][0].length] === "\n" ? 1 : 0);
  const block = parse(text.slice(start, end));
  const remaining = text.slice(0, start) + text.slice(end);
  const remainingParsed = parse(remaining);
  if (!block.mcp_servers?.[NAME] || !isDeepStrictEqual(withoutRegistration(block), {}) ||
      remainingParsed.mcp_servers?.[NAME] ||
      !isDeepStrictEqual(withoutRegistration(remainingParsed), withoutRegistration(parsed))) {
    throw new Error("Managed registration contains unrelated settings; configuration was not changed.");
  }
  return { start, end, remaining };
}

export function ownsRegistration(registration, layout) {
  return registration && samePath(registration.command, layout.node) &&
    Array.isArray(registration.args) && registration.args.length === 1 && samePath(registration.args[0], layout.server);
}

function isPreviousInstallerRegistration(registration) {
  if (!registration || typeof registration.cwd !== "string") return false;
  return ownsRegistration(registration, {
    node: resolve(registration.cwd, "runtime/node/node.exe"),
    server: resolve(registration.cwd, "server/dist/src/index.js"),
  });
}

export function updateConfigText(original, registration, layout, { remove = false, replaceExisting = false } = {}) {
  const parsed = parse(original);
  const existing = parsed.mcp_servers?.[NAME];
  const range = managedRange(original, parsed);
  if (remove) {
    if (!existing || !ownsRegistration(existing, layout)) return { text: original, changed: false, reason: "No registration owned by this installation." };
    if (!range) throw new Error("Registration is not managed by this installer. Remove it in Codex settings; configuration was not changed.");
    return { text: range.remaining, changed: true, reason: "Registration removed." };
  }
  if (existing && (!range || (!ownsRegistration(existing, layout) && !(replaceExisting && isPreviousInstallerRegistration(existing))))) {
    throw new Error("Codex already has a different structural-mcp registration. It was preserved. Remove it in Codex settings first, or use --replace-existing to switch an installer-managed older version.");
  }
  if (existing && isDeepStrictEqual(existing, registration)) return { text: original, changed: false, reason: "Already registered." };
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const block = `${BEGIN}\n${TOML.stringify({ mcp_servers: { [NAME]: registration } }).trimEnd()}\n${END}\n`.replaceAll("\n", newline);
  const text = range ? original.slice(0, range.start) + block + original.slice(range.end)
    : original + (original.length && !original.endsWith("\n") ? newline : "") + block;
  if (!isDeepStrictEqual(withoutRegistration(parse(text)), withoutRegistration(parsed))) {
    throw new Error("Configuration validation failed; no changes were written.");
  }
  return { text, changed: true, reason: "Codex registration saved." };
}

export async function updateCodexConfig(configPath, registration, layout, options = {}) {
  if (options.remove && await existingBytes(configPath) === null) return { changed: false, reason: "No Codex configuration; nothing to unregister." };
  return withLock(`${configPath}.structural-mcp.lock`, async () => {
    const original = await existingBytes(configPath);
    const result = updateConfigText(original === null ? "" : decode(original), registration, layout, options);
    if (!result.changed) return result;
    const temporary = `${configPath}.structural-mcp-${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(result.text, "utf8");
        await handle.sync();
      } finally { await handle.close(); }
      // Protect edits from a different setup and detect editors which do not use our lock.
      if (!isDeepStrictEqual(await existingBytes(configPath), original)) throw new Error("Codex configuration changed during setup. Retry; your newer configuration was preserved.");
      await rename(temporary, configPath);
      return result;
    } finally { await rm(temporary, { force: true }); }
  });
}
