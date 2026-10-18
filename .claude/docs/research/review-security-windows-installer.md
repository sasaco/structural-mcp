# Windows installer security / portability review

## Review Scope
Read-only review of `installer/build/build-installer.ps1`, `payload.mjs`, `inputs.json`, packaging tests, `installer/packaging/Product.wxs`, the WiX project and license text. Also inspected the installed FEMPython ancestor/.venv contract and searched shipped source areas for author-specific drive/user paths.

## Findings
- [Medium, fixed] `installer/build/build-installer.ps1` previously launched the staged `node.exe` to verify its own manifest before checking that executable's integrity. It now invokes the trusted build-host Node for verification, and only then uses the staged executable.
- [Medium, fixed] `installer/build/build-installer.ps1` originally bounded StagePath with a lexical Resolve-Path/StartsWith check. A junction ancestor could redirect the real output root elsewhere. StagePath and the installer work root now use `fs.realpathSync` before the descendant check; the new junction rejection test passes.
- [Medium, fixed] `installer/build/payload.mjs` originally overwrote initial source provenance during finalize. It now retains initial and final snapshots, records `sourceChangedDuringBuild`, and rejects a changed source snapshot for non-preview builds. A changed-worktree preview is explicitly identifiable rather than attributed solely to the final source snapshot.
- No remaining High/Critical findings were identified in the reviewed source. No remaining Medium issue was found after re-reading those fixes.

## Positive Evidence
- MSI uses per-user scope, LocalAppData/Programs and HKCU registry key paths. No machine environment edits or administrator-only destination was introduced.
- The uninstall hook runs only for full removal outside upgrade removal, before files disappear, and points to the correct generated File ID for bundled Node (`f786a1f4a92c5b222ec2ae920d599518`). Launcher ownership guards only remove a managed registration targeting this exact bundled Node and server.
- Setup/config editing is absent from MSI install custom actions. Unregister failure is intentionally ignored by MSI so a malformed/unowned user config remains intact and cannot block file removal.
- Node and uv archives have pinned URLs, versions and SHA-256 verification before extraction. npm uses lockfiles and disables lifecycle scripts. Produced payloads record per-file hashes and refuse missing, modified, extra and path-escaping manifest files.
- Source/build work uses unique output folders; no git checkout/reset/stash or source-tree cleanup was added. Generated publish artifacts are directed outside the user's source tree.
- Payload assembly copies an explicit set of launcher/project files and FrameWeb source; it does not copy an author `.venv`, Codex config, repository `.git`, or dotenv file. Nested payload links are rejected.
- Installed FEMPython keeps sibling FrameWeb/FrameWebforCS ancestry and creates `.venv` after relocation. Managed Python remains in a configurable user data directory; the runner resolves its runtime from the new environment's pyvenv.cfg.
- Searches across launcher/build files and relevant source projects found no author `C:\Users\sasai`, K-drive or NAS runtime path dependency.

## Test Execution Results
- Independently ran `node --test installer/build/packaging.test.mjs`: 7 passed, 0 failed, including canonical junction rejection, preview/release version mismatch, modified bytes, missing/extra files and path traversal.
- Earlier independently verified the MSI custom-action file identifier from SHA-256 of `runtime/node/node.exe`.
- No duplicate download or installer build was started by this reviewer; the ongoing packaging build remained the sole build.

## Acceptance Still Required
- Real MSI install, repair, upgrade and uninstall on a clean Windows profile/VM; source inspection is not runtime acceptance.
- End-to-end initialized staged/relocated engine calculations and artifact checks, handled separately by the verification workflow.
- Upgrade intentionally preserves the previous managed config and requires the documented explicit `--replace-existing` setup action. Setup now persists the most recent successful custom config location in a validated install-local receipt so uninstall does not depend on service environment inheritance. Additional registered custom locations still require explicit `--codex-home` cleanup.
- Artifacts are unsigned previews. Existing commercial components/fonts, unfrozen NuGet transitive restore inputs and generated data retention are explicitly disclosed in notices/manifest rather than represented as verified production distribution readiness.

## Lifecycle Follow-up
The first current-machine MSI lifecycle run confirmed that MSI install succeeded and the caller's real Codex config stayed unchanged, but exposed install-root repair and custom-home unregister issues. Packaging owns the repair-path correction. Launcher now stores the successful registration target atomically and preserves exact ownership guards, as approved by root. Eighteen isolated launcher tests pass, including absent/changed service environment and malformed receipt rejection. Retest the rebuilt MSI before marking lifecycle acceptance complete.
