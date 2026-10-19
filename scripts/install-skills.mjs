#!/usr/bin/env node
// Places the skills under skills/structural-* into the user-wide skill folders of Claude Code and Codex.
// Usage: node scripts/install-skills.mjs install|status|uninstall [--mode link|copy] [--target <abs dir>]... [--state <abs file>]
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, readlink, realpath, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const skillPrefix = "structural-";

export function defaultTargets(environment = process.env) {
  const claudeHome = environment.CLAUDE_CONFIG_DIR ?? resolve(homedir(), ".claude");
  return [resolve(claudeHome, "skills"), resolve(homedir(), ".agents", "skills")];
}

export function defaultOptions() {
  return {
    sourceRoot: resolve(repoRoot, "skills"),
    targets: defaultTargets(),
    statePath: resolve(repoRoot, ".structural-mcp", "skills-install-state.json"),
    mode: "link",
  };
}

/** Skill folders under sourceRoot whose name starts with structural- and that contain SKILL.md. */
export async function listSkills(sourceRoot) {
  const entries = await readdir(sourceRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(skillPrefix)) continue;
    const source = resolve(sourceRoot, entry.name);
    if (await exists(resolve(source, "SKILL.md"))) skills.push({ name: entry.name, source });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readState(statePath) {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (state?.schemaVersion !== 1 || !Array.isArray(state.entries)) throw new Error(`Unrecognized skill install state: ${statePath}`);
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: 1, entries: [] };
    throw error;
  }
}

async function writeState(statePath, entries) {
  await mkdir(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`, "utf8");
  await rename(temporary, statePath);
}

function samePath(a, b) {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

/** Sorted relative path -> SHA-256 of every file under a directory (links are followed). */
async function treeHashes(root) {
  const hashes = new Map();
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if ((await stat(path)).isDirectory()) await walk(path);
      else hashes.set(relative(root, path).split(sep).join("/"), createHash("sha256").update(await readFile(path)).digest("hex"));
    }
  }
  await walk(root);
  return hashes;
}

async function sameTree(a, b) {
  const [left, right] = await Promise.all([treeHashes(a), treeHashes(b)]);
  return left.size === right.size && [...left].every(([path, hash]) => right.get(path) === hash);
}

/**
 * What is at destination: missing, a link (with its target), or a real directory/file.
 * A link counts as ours when it points at the skill's source.
 */
async function inspect(destination, source) {
  let info;
  try {
    info = await lstat(destination);
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  if (info.isSymbolicLink()) {
    const target = await readlink(destination);
    return { kind: "link", target, ours: samePath(target, source) };
  }
  return { kind: info.isDirectory() ? "directory" : "file" };
}

async function remove(destination, found) {
  if (found.kind === "link") await unlink(destination);
  else await rm(destination, { recursive: true, force: true });
}

async function place(source, destination, mode) {
  await mkdir(dirname(destination), { recursive: true });
  if (mode === "link") await symlink(source, destination, "junction");
  else await cp(source, destination, { recursive: true, dereference: true, errorOnExist: true, force: false });
}

export async function install(options) {
  const { sourceRoot, targets, statePath, mode } = options;
  if (mode !== "link" && mode !== "copy") throw new Error(`--mode must be link or copy: ${mode}`);
  for (const target of targets) if (!isAbsolute(target)) throw new Error(`--target must be absolute: ${target}`);
  const skills = await listSkills(sourceRoot);
  const state = await readState(statePath);
  const recorded = (target, name) => state.entries.find((entry) => samePath(entry.target, target) && entry.name === name);

  // Check everything first so that a conflict leaves every target unchanged.
  const plan = [];
  const conflicts = [];
  for (const target of targets) {
    for (const skill of skills) {
      const destination = resolve(target, skill.name);
      const found = await inspect(destination, skill.source);
      const foreignLink = found.kind === "link" && !found.ours;
      if (foreignLink || (found.kind !== "missing" && found.kind !== "link" && !recorded(target, skill.name))) {
        conflicts.push(`${destination}（${found.kind === "link" ? `別の場所へのリンク: ${found.target}` : "このスクリプトが置いたものではない"}）`);
      }
      plan.push({ target, skill, destination, found });
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`同じ名前のスキルが既にあるため、何も変更せずに止めました。中身を確かめてから移すか消してください:\n${conflicts.map((line) => `  ${line}`).join("\n")}`);
  }

  const entries = [];
  const actions = [];
  for (const { target, skill, destination, found } of plan) {
    const upToDate = mode === "link"
      ? found.kind === "link" && found.ours
      : found.kind === "directory" && await sameTree(skill.source, destination);
    if (!upToDate) {
      if (found.kind !== "missing") await remove(destination, found);
      await place(skill.source, destination, mode);
    }
    actions.push({ destination, action: upToDate ? "unchanged" : found.kind === "missing" ? "added" : "replaced" });
    entries.push({ target, name: skill.name, mode, source: skill.source });
  }

  // Remove what an earlier install placed for skills that no longer exist in the source.
  for (const entry of state.entries) {
    const stillPlaced = entries.some((current) => samePath(current.target, entry.target) && current.name === entry.name);
    if (stillPlaced) continue;
    const isTarget = targets.some((target) => samePath(target, entry.target));
    if (!isTarget) {
      entries.push(entry);
      continue;
    }
    const destination = resolve(entry.target, entry.name);
    const found = await inspect(destination, entry.source);
    if (found.kind === "link" && !found.ours) {
      actions.push({ destination, action: "kept (link points elsewhere)" });
      continue;
    }
    if (found.kind !== "missing") await remove(destination, found);
    actions.push({ destination, action: "removed" });
  }

  await writeState(statePath, entries);
  return actions;
}

export async function uninstall(options) {
  const { targets, statePath } = options;
  const state = await readState(statePath);
  const actions = [];
  const kept = [];
  for (const entry of state.entries) {
    if (!targets.some((target) => samePath(target, entry.target))) {
      kept.push(entry);
      continue;
    }
    const destination = resolve(entry.target, entry.name);
    const found = await inspect(destination, entry.source);
    if (found.kind === "link" && !found.ours) {
      actions.push({ destination, action: "kept (link points elsewhere)" });
      continue;
    }
    if (found.kind !== "missing") await remove(destination, found);
    actions.push({ destination, action: found.kind === "missing" ? "already missing" : "removed" });
  }
  await writeState(statePath, kept);
  return actions;
}

export async function status(options) {
  const { sourceRoot, targets, statePath } = options;
  const skills = await listSkills(sourceRoot);
  const state = await readState(statePath);
  const rows = [];
  for (const target of targets) {
    for (const skill of skills) {
      const destination = resolve(target, skill.name);
      const found = await inspect(destination, skill.source);
      const owned = state.entries.some((entry) => samePath(entry.target, target) && entry.name === skill.name);
      let detail;
      if (found.kind === "missing") detail = "missing";
      else if (found.kind === "link") detail = found.ours ? "link" : `foreign link -> ${found.target}`;
      else if (!owned) detail = "foreign";
      else detail = await sameTree(skill.source, destination) ? "copy (same)" : "copy (differs)";
      rows.push({ destination, status: detail });
    }
  }
  return rows;
}

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  const options = defaultOptions();
  const targets = [];
  while (rest.length > 0) {
    const flag = rest.shift();
    const value = rest.shift();
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--mode") options.mode = value;
    else if (flag === "--target") targets.push(value);
    else if (flag === "--state") options.statePath = value;
    else if (flag === "--source") options.sourceRoot = value;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (targets.length > 0) options.targets = targets;
  return { command, options };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const run = { install, uninstall, status }[command];
  if (!run) throw new Error(`Unknown command: ${command} (install, status, uninstall)`);
  const rows = await run(options);
  if (rows.length === 0) console.log("対象のスキルはありません。");
  for (const row of rows) console.log(`${row.action ?? row.status}\t${row.destination}`);
}

if (process.argv[1] && samePath(await realpath(process.argv[1]), fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
