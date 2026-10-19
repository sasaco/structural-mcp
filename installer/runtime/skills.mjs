// Copies the bundled skills/structural-* into the user-wide skill folders of Claude Code and Codex.
// The same rules as scripts/install-skills.mjs (stop on a foreign skill of the same name before changing
// anything, remove only what this installation placed), with copies only and a receipt in the installation.
import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const skillPrefix = "structural-";
export const skillsStateName = "skills-install-state.json";
const samePath = (left, right) => resolve(left).toLowerCase() === resolve(right).toLowerCase();

/** Claude Code reads <CLAUDE_CONFIG_DIR or ~/.claude>/skills, Codex ~/.agents/skills. An explicit home replaces both. */
export function skillTargets(skillsHome, environment = process.env) {
  if (skillsHome) return [resolve(skillsHome, ".claude", "skills"), resolve(skillsHome, ".agents", "skills")];
  const claudeHome = environment.CLAUDE_CONFIG_DIR ?? resolve(homedir(), ".claude");
  return [resolve(claudeHome, "skills"), resolve(homedir(), ".agents", "skills")];
}

export async function listSkills(sourceRoot) {
  const entries = await readdir(sourceRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(skillPrefix)) continue;
    const source = resolve(sourceRoot, entry.name);
    const files = await treeHashes(source);
    if (files["SKILL.md"]) skills.push({ name: entry.name, source, files });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/** Relative path -> SHA-256 of every file; a link anywhere in the tree is refused. */
export async function treeHashes(root) {
  const hashes = {};
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Links are not allowed in a skill copy: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) hashes[relative(root, path).split(sep).join("/")] = createHash("sha256").update(await readFile(path)).digest("hex");
      else throw new Error(`Unexpected entry in a skill copy: ${path}`);
    }
  }
  await walk(root);
  return hashes;
}

const sameFiles = (left, right) => {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
};

/** missing, link (junction or symbolic link), directory or file; for a directory also its file hashes. */
async function inspect(destination) {
  let info;
  try {
    info = await lstat(destination);
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  if (info.isSymbolicLink()) return { kind: "link" };
  if (!info.isDirectory()) return { kind: "file" };
  try {
    return { kind: "directory", files: await treeHashes(destination) };
  } catch {
    return { kind: "directory", files: null };
  }
}

async function readReceipt(path, installRoot) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error("Receipt must be a regular file no larger than 4 MiB.");
    const state = JSON.parse(await readFile(path, "utf8"));
    if (state.schemaVersion !== 1 || typeof state.installRoot !== "string" || !samePath(state.installRoot, installRoot) || !Array.isArray(state.entries) ||
        state.entries.some((entry) => typeof entry.target !== "string" || !isAbsolute(entry.target) || typeof entry.name !== "string" ||
          !entry.name.startsWith(skillPrefix) || basename(entry.name) !== entry.name || typeof entry.files !== "object" || entry.files === null)) {
      throw new Error("Receipt version, installation root or entries are invalid.");
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Invalid skill receipt; no skill folder was changed: ${path}\n${error.message}`);
  }
}

async function writeReceipt(path, installRoot, entries) {
  if (entries.length === 0) return rm(path, { force: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, installRoot, entries }, null, 2)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

/** Receipts of other installations beside this one (an earlier version under Programs\structural-mcp). */
async function siblingReceipts(installRoot) {
  const parent = dirname(installRoot);
  const receipts = [];
  for (const entry of await readdir(parent, { withFileTypes: true }).catch(() => [])) {
    const root = resolve(parent, entry.name);
    if (!entry.isDirectory() || samePath(root, installRoot)) continue;
    const path = resolve(root, skillsStateName);
    const state = await readReceipt(path, root).catch(() => null);
    if (state) receipts.push({ path, root, state });
  }
  return receipts;
}

const conflictMessage = (lines) => `A skill with the same name already exists, so no skill folder was changed. Check it, then move or remove it, or run setup with --no-skills:\n${lines.map((line) => `  ${line}`).join("\n")}`;

/**
 * Place every bundled skill into every target. Everything is checked first, so a conflict changes nothing:
 * a link, a file, a folder this installation did not place, or a placed copy that was edited afterwards.
 * replaceExisting also takes over an unchanged copy recorded by another installation beside this one.
 */
export async function installSkills({ installRoot, sourceRoot, targets, replaceExisting = false, dryRun = false }) {
  const receiptPath = resolve(installRoot, skillsStateName);
  const skills = await listSkills(sourceRoot);
  const state = await readReceipt(receiptPath, installRoot);
  if (skills.length === 0 && !state) return [];
  const entries = state?.entries ?? [];
  const recorded = (target, name) => entries.find((entry) => samePath(entry.target, target) && entry.name === name);
  const siblings = replaceExisting ? await siblingReceipts(installRoot) : [];
  const plan = [];
  const conflicts = [];
  for (const target of targets) {
    for (const skill of skills) {
      const destination = resolve(target, skill.name);
      const found = await inspect(destination);
      const own = recorded(target, skill.name);
      let takeover = null;
      if (found.kind === "directory" && !own) {
        takeover = siblings.find(({ state: other }) => other.entries.some((entry) =>
          samePath(entry.target, target) && entry.name === skill.name && found.files && sameFiles(entry.files, found.files))) ?? null;
      }
      if (found.kind === "link" || found.kind === "file") conflicts.push(`${destination} (${found.kind === "link" ? "a link" : "a file"})`);
      else if (found.kind === "directory" && own && !own.pending && !(found.files && sameFiles(own.files, found.files))) conflicts.push(`${destination} (edited after this installation placed it)`);
      else if (found.kind === "directory" && !own && !takeover) conflicts.push(`${destination} (not placed by this installation${replaceExisting ? "" : "; an earlier structural-mcp installation's unchanged copy is replaced only with --replace-existing"})`);
      plan.push({ target, skill, destination, found, takeover });
    }
  }
  if (conflicts.length) throw new Error(conflictMessage(conflicts));
  if (dryRun) return [];

  const actions = [];
  const save = () => writeReceipt(receiptPath, installRoot, entries);
  for (const { target, skill, destination, found, takeover } of plan) {
    const index = entries.findIndex((entry) => samePath(entry.target, target) && entry.name === skill.name);
    if (index >= 0) entries.splice(index, 1);
    if (found.kind === "directory" && found.files && sameFiles(found.files, skill.files)) {
      entries.push({ target, name: skill.name, files: skill.files });
      actions.push({ destination, action: "unchanged" });
    } else {
      // Recorded as pending before anything is removed or copied, so an interrupted copy stays ours and is
      // replaced by the next setup or removed by unregister.
      const entry = { target, name: skill.name, files: skill.files, pending: true };
      entries.push(entry);
      await save();
      await mkdir(target, { recursive: true });
      if (found.kind === "directory") await rm(destination, { recursive: true });
      await cp(skill.source, destination, { recursive: true, errorOnExist: true, force: false });
      if (!sameFiles(await treeHashes(destination), skill.files)) throw new Error(`Copied skill differs from the installation: ${destination}`);
      delete entry.pending;
      actions.push({ destination, action: found.kind === "missing" ? "added" : "replaced" });
    }
    if (takeover) {
      takeover.state.entries = takeover.state.entries.filter((entry) => !(samePath(entry.target, target) && entry.name === skill.name));
      await writeReceipt(takeover.path, takeover.root, takeover.state.entries);
    }
  }
  // A skill an earlier setup of this installation placed but which is no longer bundled.
  const bundled = new Set(skills.map((skill) => skill.name));
  for (const entry of [...entries]) {
    if (bundled.has(entry.name) || !targets.some((target) => samePath(target, entry.target))) continue;
    actions.push(await removeEntry(entry));
    entries.splice(entries.indexOf(entry), 1);
  }
  await save();
  return actions;
}

async function removeEntry(entry) {
  const destination = resolve(entry.target, entry.name);
  const found = await inspect(destination);
  if (found.kind === "missing") return { destination, action: "already missing" };
  if (found.kind !== "directory" || (!entry.pending && (!found.files || !sameFiles(found.files, entry.files)))) {
    return { destination, action: `kept (${found.kind === "directory" ? "edited after it was placed" : `now a ${found.kind}`})` };
  }
  await rm(destination, { recursive: true });
  return { destination, action: "removed" };
}

/** Remove what this installation placed and is unchanged; edited copies and links are kept and forgotten. */
export async function uninstallSkills({ installRoot }) {
  const receiptPath = resolve(installRoot, skillsStateName);
  const state = await readReceipt(receiptPath, installRoot);
  if (!state) return [];
  const actions = [];
  for (const entry of state.entries) actions.push(await removeEntry(entry));
  await writeReceipt(receiptPath, installRoot, []);
  return actions;
}

/** Every placed copy must still equal the bundled skill byte for byte (SHA-256). */
export async function checkSkills({ installRoot, sourceRoot }) {
  const state = await readReceipt(resolve(installRoot, skillsStateName), installRoot);
  if (!state) return null;
  const skills = new Map((await listSkills(sourceRoot)).map((skill) => [skill.name, skill]));
  const problems = [];
  for (const entry of state.entries) {
    const destination = resolve(entry.target, entry.name);
    const skill = skills.get(entry.name);
    const found = await inspect(destination);
    if (!skill) problems.push(`${destination} is no longer bundled; run setup again`);
    else if (found.kind !== "directory" || !found.files) problems.push(`${destination} is ${found.kind === "missing" ? "missing" : `a ${found.kind}`}`);
    else if (!sameFiles(found.files, skill.files)) problems.push(`${destination} differs from the bundled skill`);
  }
  if (problems.length) throw new Error(`Skill check failed (run setup again to restore them):\n${problems.map((line) => `  ${line}`).join("\n")}`);
  return state.entries.map((entry) => resolve(entry.target, entry.name));
}
