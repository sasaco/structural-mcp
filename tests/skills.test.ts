import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const skillsRoot = resolve(repositoryRoot, "skills");

interface InstallOptions { sourceRoot: string; targets: string[]; statePath: string; mode: "link" | "copy" }
interface InstallModule {
  install(options: InstallOptions): Promise<{ destination: string; action: string }[]>;
  uninstall(options: InstallOptions): Promise<{ destination: string; action: string }[]>;
  status(options: InstallOptions): Promise<{ destination: string; status: string }[]>;
}

const installer = await import(pathToFileURL(resolve(repositoryRoot, "scripts/install-skills.mjs")).href) as InstallModule;

async function filesUnder(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function frontmatter(text: string): Map<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  assert.ok(match, "SKILL.md must start with a --- frontmatter block");
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (field) fields.set(field[1]!, field[2]!.trim());
  }
  return fields;
}

// Paths that only work on one machine, or that address scripts through a project's skill folder.
const forbiddenPatterns: { pattern: RegExp; reason: string }[] = [
  { pattern: /[A-Za-z]:\\Users\\(?!<)[^\\\s`]+/, reason: "利用者のフォルダーの絶対パス" },
  { pattern: /\/c\/Users\/(?!<)/i, reason: "利用者のフォルダーの絶対パス" },
  { pattern: /\b[K-Zk-z]:\\/, reason: "ネットワークドライブの絶対パス" },
  { pattern: /\.(?:claude|agents)[\\/]skills[\\/][^\s`)]*[\\/]scripts[\\/]/, reason: "スクリプトはスキルのフォルダーからの相対パスで書く" },
  { pattern: /skills[\\/]synced\b/, reason: "claude.ai の同期フォルダー" },
];

const skillFolders = (await readdir(skillsRoot, { withFileTypes: true }).catch(() => []))
  .filter((entry) => entry.isDirectory())
  .map((entry) => resolve(skillsRoot, entry.name));

test("skills/ has only structural-* skill folders, each with a SKILL.md", async () => {
  for (const folder of skillFolders) {
    const name = relative(skillsRoot, folder);
    assert.match(name, /^structural-[a-z0-9-]+$/, `${name}: skill folders are named structural-<lowercase>`);
    assert.ok(await exists(resolve(folder, "SKILL.md")), `${name}: SKILL.md is missing`);
  }
});

test("every Markdown file under skills/ is UTF-8 without a BOM (Codex skips skills with a BOM)", async () => {
  if (!await exists(skillsRoot)) return;
  for (const path of await filesUnder(skillsRoot)) {
    if (!path.endsWith(".md")) continue;
    const bytes = await readFile(path);
    assert.ok(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), `${relative(repositoryRoot, path)} starts with a BOM`);
    assert.ok(!bytes.toString("utf8").includes("�"), `${relative(repositoryRoot, path)} is not valid UTF-8`);
  }
});

for (const folder of skillFolders) {
  const name = relative(skillsRoot, folder);

  test(`${name}: frontmatter name matches the folder and the description fits`, async () => {
    const fields = frontmatter(await readFile(resolve(folder, "SKILL.md"), "utf8"));
    assert.equal(fields.get("name"), name);
    const description = fields.get("description") ?? "";
    assert.ok(description.length > 0, "description is empty");
    assert.ok(description.length <= 1024, `description is ${description.length} characters (max 1024)`);
  });

  test(`${name}: links and scripts/ references/ paths resolve, and no machine-specific paths`, async () => {
    for (const path of await filesUnder(folder)) {
      if (!path.endsWith(".md")) continue;
      const text = await readFile(path, "utf8");
      const where = relative(repositoryRoot, path);
      for (const [, link] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(?:[a-z]+:|#)/i.test(link!)) continue;
        const target = resolve(dirname(path), decodeURI(link!.split("#")[0]!));
        assert.ok(await exists(target), `${where}: link target is missing: ${link}`);
      }
      for (const [, reference] of text.matchAll(/`((?:scripts|references)\/[^`\s]+)`/g)) {
        assert.ok(await exists(resolve(folder, reference!)), `${where}: ${reference} does not exist in ${name}`);
      }
      for (const { pattern, reason } of forbiddenPatterns) {
        const found = pattern.exec(text);
        assert.equal(found, null, `${where}: ${reason}: ${found?.[0]}`);
      }
    }
  });
}

async function installFixture(t: TestContext) {
  const root = await mkdtemp(resolve(tmpdir(), "structural-mcp-skills-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const sourceRoot = resolve(root, "source");
  for (const name of ["structural-alpha", "structural-beta", "unrelated"]) {
    await mkdir(resolve(sourceRoot, name, "references"), { recursive: true });
    await writeFile(resolve(sourceRoot, name, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n`);
    await writeFile(resolve(sourceRoot, name, "references", "note.md"), name);
  }
  const options: InstallOptions = {
    sourceRoot,
    targets: [resolve(root, "claude", "skills"), resolve(root, "agents", "skills")],
    statePath: resolve(root, "state.json"),
    mode: "link",
  };
  return { root, sourceRoot, options };
}

test("install links each structural-* skill into every target and is idempotent", async (t) => {
  const { sourceRoot, options } = await installFixture(t);
  const first = await installer.install(options);
  assert.deepEqual(first.map((row) => row.action), ["added", "added", "added", "added"]);
  for (const target of options.targets) {
    const link = resolve(target, "structural-alpha");
    assert.ok((await lstat(link)).isSymbolicLink());
    assert.equal(resolve(await readlink(link)).toLowerCase(), resolve(sourceRoot, "structural-alpha").toLowerCase());
    assert.equal(await readFile(resolve(link, "references", "note.md"), "utf8"), "structural-alpha");
    assert.ok(!await exists(resolve(target, "unrelated")), "only structural-* skills are installed");
  }
  const second = await installer.install(options);
  assert.ok(second.every((row) => row.action === "unchanged"));
  assert.ok((await installer.status(options)).every((row) => row.status === "link"));
});

test("install stops without changing anything when a foreign skill has the same name", async (t) => {
  const { options } = await installFixture(t);
  const foreign = resolve(options.targets[1]!, "structural-beta");
  await mkdir(foreign, { recursive: true });
  await writeFile(resolve(foreign, "SKILL.md"), "someone else's");
  await assert.rejects(installer.install(options), /structural-beta/);
  assert.ok(!await exists(resolve(options.targets[0]!, "structural-alpha")), "no target was changed");
  assert.equal(await readFile(resolve(foreign, "SKILL.md"), "utf8"), "someone else's");
  assert.ok(!await exists(options.statePath));
});

test("copy mode copies the files, and status reports a changed copy", async (t) => {
  const { sourceRoot, options } = await installFixture(t);
  const copy = { ...options, mode: "copy" as const };
  await installer.install(copy);
  const placed = resolve(options.targets[0]!, "structural-alpha");
  assert.ok(!(await lstat(placed)).isSymbolicLink());
  assert.equal(await readFile(resolve(placed, "references", "note.md"), "utf8"), "structural-alpha");
  assert.ok((await installer.status(copy)).every((row) => row.status === "copy (same)"));
  await writeFile(resolve(sourceRoot, "structural-alpha", "references", "note.md"), "changed");
  assert.ok((await installer.status(copy)).some((row) => row.status === "copy (differs)"));
  const again = await installer.install(copy);
  assert.ok(again.some((row) => row.action === "replaced"));
  assert.equal(await readFile(resolve(placed, "references", "note.md"), "utf8"), "changed");
});

test("install removes skills that left the source, and uninstall removes only what it placed", async (t) => {
  const { sourceRoot, options } = await installFixture(t);
  await installer.install(options);
  await rm(resolve(sourceRoot, "structural-beta"), { recursive: true });
  const pruned = await installer.install(options);
  assert.ok(pruned.some((row) => row.action === "removed" && row.destination.endsWith("structural-beta")));
  for (const target of options.targets) assert.ok(!await exists(resolve(target, "structural-beta")));

  const neighbour = resolve(options.targets[0]!, "linksee-memory");
  await mkdir(neighbour, { recursive: true });
  await installer.uninstall(options);
  for (const target of options.targets) assert.ok(!await exists(resolve(target, "structural-alpha")));
  assert.ok(await exists(neighbour), "other skills stay");
  assert.ok(await exists(resolve(sourceRoot, "structural-alpha", "SKILL.md")), "uninstalling a link keeps the source");
});
