import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const [command, first, second, third] = process.argv.slice(2);
const hash = data => createHash('sha256').update(data).digest('hex');
const slash = name => name.replaceAll('\\', '/');
const json = async name => JSON.parse(await fs.readFile(name, 'utf8'));
const writeJson = async (name, data) => fs.writeFile(name, `${JSON.stringify(data, null, 2)}\n`);
async function files(root) {
  const result = [];
  async function walk(directory) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Reparse/symbolic-link payload is forbidden: ${full}`);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) result.push(full);
    }
  }
  await walk(root);
  return result;
}
async function copy(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}
async function copyTree(source, destination) {
  for (const file of await files(source)) {
    const relative = path.relative(source, file);
    if (relative.split(path.sep).some(part => ['__pycache__', '.venv', 'node_modules'].includes(part)) || /\.(pyc|pyo)$/.test(file)) continue;
    await copy(file, path.join(destination, relative));
  }
}
function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}
async function sources(repo, run, preview, filename = 'source-provenance.json') {
  const records = [];
  const scopes = {
    '.': ['src', 'tests', 'package.json', 'package-lock.json', 'tsconfig.json', 'installer', 'skills'],
    Capacita: ['RcDan', 'RcSolver', 'SteelDan', 'WebDanforCS', 'Directory.Build.props', 'global.json'],
    SoilStructure: ['SoilPile', 'SoilDisp', 'SoilStructure', 'Directory.Build.props', 'global.json'],
    Batch: ['Aggre-SE', 'RCNonlinear', 'WinPDFPrint', 'Docu-SE.sln'],
    WebPier: ['webpier', 'run_headless.py', 'pyproject.toml', 'uv.lock', 'README.md'],
    FEMPython: ['FrameWeb/src', 'FrameWeb/pyproject.toml', 'FrameWeb/uv.lock', 'FrameWeb/README.md', 'FrameWeb/LICENSE', 'FrameWebforCS', 'FrameGConverter/Convert_Manager', 'FramePrintPDF/PDF_Manager', 'THREE', 'Directory.Build.props', 'global.json'],
  };
  for (const name of ['.', 'Capacita', 'SoilStructure', 'FEMPython', 'Batch', 'WebPier']) {
    const root = path.resolve(repo, name);
    const allStatus = git(root, 'status', '--porcelain=v1', '--untracked-files=normal');
    const status = git(root, 'status', '--porcelain=v1', '--untracked-files=all', '--', ...scopes[name]);
    const modified = git(root, 'ls-files', '--modified', '--others', '--exclude-standard', '-z', '--', ...scopes[name]).split('\0').filter(Boolean);
    const workingFiles = [];
    for (const relative of [...new Set(modified)].sort()) {
      const file = path.join(root, relative);
      const stat = await fs.stat(file).catch(() => null);
      if (stat?.isFile()) workingFiles.push({ path: slash(relative), sha256: hash(await fs.readFile(file)) });
    }
    records.push({ repository: name, commit: git(root, 'rev-parse', 'HEAD').trim(), dirty: allStatus.length > 0, packagedSourceDirty: status.length > 0,
      status: status.trimEnd().split('\n').filter(Boolean), workingFiles });
  }
  if (!preview && records.some(record => record.dirty)) throw new Error('Release builds require clean root/submodule worktrees. Use -Preview to label a worktree build.');
  await writeJson(path.join(run, filename), records);
  return records;
}
async function prepare(repo, payload) {
  const runtime = path.join(repo, 'installer', 'runtime');
  for (const name of ['launcher.mjs', 'codex-config.mjs', 'skills.mjs','package.json', 'package-lock.json', 'setup.cmd', 'health.cmd', 'unregister-codex.cmd', 'structural-mcp.ps1']) {
    await copy(path.join(runtime, name), path.join(payload, name));
  }
  const frame = path.join(repo, 'FEMPython', 'FrameWeb');
  const target = path.join(payload, 'engines', 'FEMPython', 'FrameWeb');
  for (const name of ['pyproject.toml', 'uv.lock', 'README.md', 'LICENSE', 'MANIFEST.in']) await copy(path.join(frame, name), path.join(target, name));
  await copyTree(path.join(frame, 'src'), path.join(target, 'src'));
  const inputs = await json(path.join(repo, 'installer', 'build', 'inputs.json'));
  await fs.writeFile(path.join(target, '.python-version'), `${inputs.python}\n`);
  // WebPier: the headless runner and its package; setup builds the .venv beside run_headless.py from uv.lock.
  const webPier = path.join(repo, 'WebPier');
  const webPierTarget = path.join(payload, 'engines', 'WebPier');
  for (const name of ['run_headless.py', 'pyproject.toml', 'uv.lock', 'README.md']) await copy(path.join(webPier, name), path.join(webPierTarget, name));
  await copyTree(path.join(webPier, 'webpier'), path.join(webPierTarget, 'webpier'));
  await fs.writeFile(path.join(webPierTarget, '.python-version'), `${inputs.python}\n`);
  // Global skills, which setup copies into the Claude Code and Codex skill folders.
  for (const entry of await fs.readdir(path.join(repo, 'skills'), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('structural-')) await copyTree(path.join(repo, 'skills', entry.name), path.join(payload, 'skills', entry.name));
  }
  await copy(path.join(repo, 'installer', 'README.md'), path.join(payload, 'INSTALLER-README.md'));
  await copy(path.join(repo, 'SoilStructure', 'SoilPile', 'Reporting', 'Fonts', 'OFL.txt'), path.join(payload, 'licenses', 'BIZUDMincho-OFL.txt'));
  await copy(path.join(frame, 'LICENSE'), path.join(payload, 'licenses', 'FEMPython-LICENSE.txt'));
}
async function collectLicenses(repo, run, payload, inputs) {
  const licensesRoot = path.join(payload, 'licenses');
  const nugetNotices = path.join(licensesRoot, 'nuget');
  const canonicalPayload = await fs.realpath(payload);
  const existingNotices = await fs.realpath(nugetNotices).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existingNotices) {
    if (!existingNotices.startsWith(canonicalPayload + path.sep)) throw new Error('NuGet notices directory escapes payload.');
    // Only this generator's notice subtree is replaced, never user data or source files.
    await fs.rm(nugetNotices, { recursive: true });
  }
  const inventory = { npm: [], nuget: [], externalPython: 'Resolved by shipped FrameWeb/uv.lock and WebPier/uv.lock during explicit initialization.' };
  for (const root of [path.join(payload, 'server', 'node_modules'), path.join(payload, 'node_modules')]) {
    for (const file of (await files(root)).filter(file => path.basename(file) === 'package.json')) {
      const metadata = await json(file);
      if (metadata.name && metadata.version) inventory.npm.push({ name: metadata.name, version: metadata.version, license: metadata.license ?? null });
    }
  }
  const packageRoots = new Map();
  const artifacts = (await fs.readdir(run, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith('dotnet-')).map(entry => entry.name);
  for (const name of artifacts) {
    for (const assetFile of (await files(path.join(run, name))).filter(file => path.basename(file) === 'project.assets.json')) {
      const asset = await json(assetFile);
      for (const [key, library] of Object.entries(asset.libraries)) {
        if (library.type !== 'package') continue;
        for (const folder of Object.keys(asset.packageFolders)) {
          const location = path.join(folder, library.path);
          if (await fs.stat(location).catch(() => null)) { packageRoots.set(key, location); break; }
        }
      }
      for (const folder of Object.keys(asset.packageFolders)) {
        for (const [name, version] of [['Microsoft.NETCore.App.Runtime.win-x64', inputs.dotnetRuntime8], ['Microsoft.NETCore.App.Runtime.win-x64', inputs.dotnetRuntime10], ['Microsoft.WindowsDesktop.App.Runtime.win-x64', inputs.dotnetRuntime10]]) {
          const location = path.join(folder, name.toLowerCase(), version);
          if (await fs.stat(location).catch(() => null)) packageRoots.set(`${name}/${version}`, location);
        }
      }
    }
  }
  for (const [key, location] of [...packageRoots].sort()) {
    const [name, version] = key.split('/');
    const relevant = (await files(location)).filter(file => /(?:license|notice|copying|\.nuspec$)/i.test(path.basename(file)));
    const record = { name, version, noticeFiles: [] };
    for (const file of relevant) {
      const relative = file.endsWith('.nuspec') ? 'package.nuspec' : path.relative(location, file);
      // Short package keys also keep Windows Installer v5 paths below MAX_PATH.
      const destination = path.join(nugetNotices, hash(key).slice(0, 16), relative);
      await copy(file, destination);
      record.noticeFiles.push(slash(path.relative(payload, destination)));
    }
    inventory.nuget.push(record);
  }
  for (const name of ['LICENSE-MIT', 'LICENSE-APACHE']) {
    const response = await fetch(`https://raw.githubusercontent.com/astral-sh/uv/${inputs.uv.version}/${name}`);
    if (!response.ok) throw new Error(`Unable to download uv license ${name}: ${response.status}`);
    await fs.writeFile(path.join(licensesRoot, `uv-${name}.txt`), await response.text());
  }
  await writeJson(path.join(licensesRoot, 'dependency-inventory.json'), inventory);
  await fs.writeFile(path.join(payload, 'THIRD-PARTY-NOTICES.md'), `# Third-party notices\n\nThis is an unsigned preview assembled from the source revisions and worktree hashes recorded in release-manifest.json. No repository-wide distribution license was found; this package does not grant redistribution rights.\n\n- Node.js ${inputs.node.version}: licenses/node-LICENSE.txt includes its dependency notices.\n- uv ${inputs.uv.version}: licenses/uv-LICENSE-MIT.txt and licenses/uv-LICENSE-APACHE.txt.\n- FEMPython Python source: licenses/FEMPython-LICENSE.txt. Locked dependencies and managed CPython are downloaded during initialization; their installed distributions retain license metadata.\n- WebPier Python source (engines/WebPier, https://github.com/sasaco/WebPier): no license file was found in its repository. Its locked dependencies are downloaded during initialization from engines/WebPier/uv.lock, including GridLayoutPdf 0.1.0 as the wheel published at https://github.com/sasaco/grid_layout_pdf/releases/tag/v0.1.0 (no license file was found in that repository either).\n- Skills (skills/structural-*): instructions for Claude Code and Codex from the structural-mcp repository, copied by setup into the user's skill folders.\n- .NET runtimes and NuGet dependencies: licenses/nuget and licenses/dependency-inventory.json. npm licenses remain beside their packages in node_modules.\n- BIZUDMincho font: licenses/BIZUDMincho-OFL.txt.\n\n## Distribution review still required\n\nThe runners include GrapeCity Spread components, EPPlus 7, and (Aggre-SE / Batch, engines/Aggre-SE) GrapeCity SPREAD 15, ComponentOne 2015 (C1Pdf, C1Report, C1Chart, C1Zip, C1 WPF), AdvanceSoftware VB-Report8, iTextSharp and SNAPDBLib, and embedded fonts such as MS Gothic, MS Mincho and SimSun. WebPier renders with the Windows fonts installed on the PC (MS Mincho, MS Gothic, Calibri, Times New Roman Italic); they are not bundled. Their commercial/distribution rights have not been verified. Review the original package terms and your organization's entitlements before sharing outside your licensed environment. The included third-party notices are evidence, not a grant of rights.\n\nJRSNAP (Railway Technical Research Institute) and its runner JRSNAPHeadless are not bundled, so WebPier's JRSNAP stages (0710 and later) are unavailable in this package.\n\nWiX 5.0.2 builds this MSI and is not a runtime dependency. Source: https://www.nuget.org/packages/WixToolset.Sdk/5.0.2\n`);
}
async function finalize(repo, run, version) {
  const payload = path.join(run, 'payload');
  const inputs = await json(path.join(repo, 'installer', 'build', 'inputs.json'));
  await collectLicenses(repo, run, payload, inputs);
  const initialSources = await json(path.join(run, 'source-provenance.json'));
  const finalSources = await sources(repo, run, version.includes('preview'), 'source-provenance-final.json');
  const sourceChangedDuringBuild = JSON.stringify(initialSources) !== JSON.stringify(finalSources);
  if (sourceChangedDuringBuild && !version.includes('preview')) throw new Error('Source changed during release build. Rebuild from a stable clean checkout.');
  const records = [];
  for (const file of await files(payload)) {
    const relative = slash(path.relative(payload, file));
    if (relative === 'release-manifest.json') continue;
    if (relative.split('/').some(part => ['.env', '.venv', '.git', '__pycache__', '.codex'].includes(part))) throw new Error(`Forbidden payload path: ${relative}`);
    const data = await fs.readFile(file);
    records.push({ path: relative, sha256: hash(data), bytes: data.length });
  }
  const manifest = { schemaVersion: 1, version, channel: version.includes('preview') ? 'preview' : 'unsigned-candidate',
    signed: false, createdUtc: new Date().toISOString(), platform: 'win-x64', inputs,
    sources: initialSources, sourceSnapshotAtPackaging: finalSources, sourceChangedDuringBuild, files: records,
    limitations: ['Unsigned; clean-VM install/repair/upgrade/uninstall acceptance is not implied.', 'FEMPython and WebPier need online first-run initialization.', 'JRSNAP and JRSNAPHeadless are not bundled: WebPier stages 0710 and later, and the stages that depend on them, are unavailable.', 'Commercial component and embedded font redistribution rights require review.', 'Aggre-SE runner (.NET Framework 4.8) is built with Visual Studio MSBuild from the developer machine vendor installs (SPREAD 15, ComponentOne 2015, VB-Report8); their runtime redistribution terms and the iTextSharp version license require review.', 'Existing SixLabors.ImageSharp 2.1.13 dependency generates NU1902/NU1903 vulnerability warnings; engine dependencies were not upgraded by packaging.', 'NuGet transitive resolutions are recorded in dependency-inventory.json; full reproducible release requires frozen restore inputs.'] };
  await writeJson(path.join(payload, 'release-manifest.json'), manifest);
  await copy(path.join(payload, 'release-manifest.json'), path.join(run, 'release-manifest.json'));
}
async function verify(payload) {
  const manifest = await json(path.join(payload, 'release-manifest.json'));
  const expected = new Set(manifest.files.map(file => file.path));
  for (const record of manifest.files) {
    const full = path.resolve(payload, record.path);
    if (!full.startsWith(path.resolve(payload) + path.sep)) throw new Error(`Manifest path escapes payload: ${record.path}`);
    const data = await fs.readFile(full);
    if (data.length !== record.bytes || hash(data) !== record.sha256) throw new Error(`Payload differs from manifest: ${record.path}`);
  }
  for (const full of await files(payload)) {
    const name = slash(path.relative(payload, full));
    if (name !== 'release-manifest.json' && !expected.has(name)) throw new Error(`Unrecorded payload file: ${name}`);
  }
}
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function componentGuid(version, relative) {
  const namespace = Buffer.from('e617f8906a7d4bdda7527ac3e7759b28', 'hex');
  const bytes = createHash('sha1').update(namespace).update(`${version}/${slash(relative).toLowerCase()}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
async function wix(payload, run) {
  const all = await files(payload);
  const { version } = await json(path.join(payload, 'release-manifest.json'));
  if (all.some(file => path.relative(payload, file).split(path.sep).includes('.venv'))) throw new Error('Do not package a bootstrapped payload; use the original clean stage.');
  const directoryId = relative => relative ? `D${hash(slash(relative).toLowerCase()).slice(0, 32)}` : 'INSTALLFOLDER';
  const directories = new Set();
  for (const file of all) {
    let directory = path.dirname(path.relative(payload, file));
    while (directory !== '.') { directories.add(directory); directory = path.dirname(directory); }
  }
  const lines = ['<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">', '<Fragment>'];
  for (const directory of [...directories].sort()) {
    const parent = path.dirname(directory);
    lines.push(`<DirectoryRef Id="${directoryId(parent === '.' ? '' : parent)}"><Directory Id="${directoryId(directory)}" Name="${xml(path.basename(directory))}" /></DirectoryRef>`);
  }
  lines.push('<ComponentGroup Id="PayloadComponents">');
  const cleanedDirectories = new Set();
  for (const file of all) {
    const relative = path.relative(payload, file);
    const directory = path.dirname(relative) === '.' ? '' : path.dirname(relative);
    const id = hash(slash(relative).toLowerCase()).slice(0, 32);
    lines.push(`<Component Id="C${id}" Directory="${directoryId(directory)}" Guid="${componentGuid(version, relative)}">`,
      `<File Id="F${id}" Source="${xml(file)}" />`,
      `<RegistryValue Root="HKCU" Key="Software\\sasaco\\structural-mcp\\Installer\\$(var.InstallVersion)\\Files" Name="${id}" Type="integer" Value="1" KeyPath="yes" />`);
    if (!cleanedDirectories.has(directory)) {
      lines.push(`<RemoveFolder Id="R${id}" On="uninstall" />`);
      cleanedDirectories.add(directory);
    }
    lines.push('</Component>');
  }
  const intermediateDirectories = [...directories].filter(directory => !cleanedDirectories.has(directory));
  if (intermediateDirectories.length) {
    lines.push('<Component Id="PayloadDirectoryCleanup" Directory="INSTALLFOLDER" Guid="*">',
      '<RegistryValue Root="HKCU" Key="Software\\sasaco\\structural-mcp\\Installer\\$(var.InstallVersion)" Name="DirectoryCleanup" Type="integer" Value="1" KeyPath="yes" />');
    for (const directory of intermediateDirectories) {
      const id = directoryId(directory);
      lines.push(`<RemoveFolder Id="Remove${id}" Directory="${id}" On="uninstall" />`);
    }
    lines.push('</Component>');
  }
  lines.push('</ComponentGroup>', '</Fragment>', '</Wix>');
  await fs.writeFile(path.join(run, 'Payload.wxs'), `${lines.join('\n')}\n`);
}

if (command === 'sources') await sources(first, second, third.toLowerCase() === 'true');
else if (command === 'copy') await prepare(first, second);
else if (command === 'finalize') await finalize(first, second, third);
else if (command === 'wix') await wix(first, second);
else if (command === 'verify') await verify(first);
else throw new Error(`Unknown payload command: ${command}`);
