# Work Log: Packaging

## Summary

Implemented and built a per-user Windows x64 MSI containing a fixed Node runtime, production npm dependencies, self-contained .NET runners, uv, and the locked FEMPython source project. The current candidate is the `repairfix1` unsigned preview; it replaces the first MSI after independent lifecycle testing exposed maintenance defects. Source worktree state and file hashes are recorded without reverting or changing the user's engine sources.

## Tasks Completed

- [x] Implemented pinned runtime downloads with SHA-256 verification, bounded archive extraction, isolated TypeScript/npm staging, and self-contained publishing for all three runners.
- [x] Implemented WiX 5.0.2 packaging with a normal minimal installer UI, Start Menu setup/health/unregister shortcuts, per-user HKCU components, repair/upgrade metadata, and an uninstall-only ownership-checked Codex unregister command.
- [x] Added dependency inventory, copied third-party notices, source snapshots before and after build, every-payload-file SHA-256, MSI SHA-256, and a sidecar recording actual packaging source hashes and SDK versions.
- [x] Preserved pre-build provenance instead of replacing it. Preview records `sourceChangedDuringBuild`; release builds reject dirty or changing sources.
- [x] Added canonical StagePath containment checks, trusted-host verification before executing staged Node, rejection of links/unrecorded files, and preview/version mismatch rejection.
- [x] Produced the frozen MSI and handed its exact SHA-256 to the independent lifecycle verifier.

## Files Modified

- `installer/build/build-installer.ps1`: complete isolated build and repackage entry point; writes outputs only under ignored installer-work directories.
- `installer/build/inputs.json`: Node 24.22.0, uv 0.10.0, Python 3.12.12, WiX 5.0.2, and .NET 8.0.32 / 10.0.13 inputs.
- `installer/build/payload.mjs`: source provenance, whitelisted payload copying, notices/inventory, integrity checks, and deterministic WiX generation.
- `installer/build/packaging.test.mjs`: seven meaningful positive/negative integrity, containment, and release-label tests.
- `installer/packaging/structural-mcp.wixproj`: pinned local WiX SDK and UI extension.
- `installer/packaging/Product.wxs`: per-user product, explicit setup shortcuts, guarded uninstall, and directory cleanup.
- `installer/packaging/License.rtf`: preview installation notice and first-run/uninstall instructions.

## Key Decisions

- The MSI installs files without registering Codex. The user explicitly runs the setup shortcut afterward. Uninstall invokes only `unregister-codex --quiet`, before file removal and outside major-upgrade removal; the launcher preserves unrelated registrations and malformed settings.
- Fixed Node and uv archives are checked against recorded upstream SHA-256 values. No global WiX tool installation or update occurs.
- Engine outputs are self-contained; FEMPython retains the required sibling `FrameWeb` / `FrameWebforCS` layout and creates its Python environment only on the destination PC.
- Existing source lockfiles are preserved. NuGet is directed to an unused lockfile path under the isolated artifacts tree, with lockfile writing disabled, because adding the Windows RID would otherwise conflict with existing Linux-oriented locks. Exact restored packages and notices are inventoried; complete transitive release reproducibility remains a stated limitation.
- File-plus-HKCU components use deterministic UUIDv5 values based on installation version and relative path. WiX cannot auto-generate GUIDs for those components.
- NuGet notices use short hash-keyed directories and `package.nuspec`, retaining full package identity in the inventory, to remain within WiX 5 / Windows path limits.
- The current engine dependency graph is preserved. Existing ImageSharp vulnerability warnings and proprietary component/font redistribution limitations are recorded rather than hidden or silently upgraded.

## Validation

- `node --test installer/build/packaging.test.mjs`: exit 0, 7 tests passed. Cases cover valid payload, same-length tampering, extra files, missing files, manifest path escape, a directory junction escaping the work root, and preview/version misuse.
- PowerShell AST parsing and `node --check installer/build/payload.mjs`: passed.
- Corrected full build command `powershell -NoProfile -ExecutionPolicy Bypass -File installer/build/build-installer.ps1 -Preview -SkipMsi`: exit 0. Proof output: `.structural-mcp/installer-work/20261016-191430-629c459b/payload`.
- Final payload hash/inventory verification: exit 0 after shortening notice paths. There are 4,999 recorded payload files; maximum relative path length is 116 characters.
- Compared final payload hashes with the independently successful relocated calculation smoke: all 4,548 non-license files match exactly, with zero changed non-license files. Smoke evidence: `C:/Users/sasai/AppData/Local/Temp/structural-mcp-verify-NTYSrf/verification.json`.
- Final MSI packaging: exit 0, validation enabled, zero errors. Unsuppressed warnings: 5,000 ICE91 messages about deliberately per-user-only file destinations, and one ICE61 warning from intentional same-version preview upgrades. Full log: `.structural-mcp/installer-work/20261016-185314-f5507b34/wix-build.log`.
- Repository `.agents/check.ps1` is absent. Relevant checks above were run directly; no canonical-gate pass is claimed.

## Revised Artifact

- MSI: `C:/Users/sasai/Documents/structural-mcp/.structural-mcp/installer-work/20261016-185314-f5507b34/msi-repairfix1/structural-mcp-0.2.0-preview-repairfix1-win-x64.msi`
- SHA-256: `add364c02ae155f70613bfd8f74270dc7c714cc147b56c4b09ef5cf562df160e`
- Size: 180,147,088 bytes.
- Built with `powershell -NoProfile -ExecutionPolicy Bypass -File installer/build/build-installer.ps1 -Preview -StagePath 'C:\Users\sasai\Documents\structural-mcp\.structural-mcp\installer-work\20261016-185314-f5507b34\payload' -ArtifactSuffix repairfix1`.
- Build exit 0, elapsed 7m11s; Windows Installer validation enabled, 5,001 unsuppressed warnings (5,000 ICE91 and one ICE61), zero errors. Log: `wix-build-repairfix1.log` under the build directory.
- Version-scoped HKCU `InstallFolder` persistence now restores the selected location before costing. Runtime registration now writes install-local state so unregister uses the actual Codex target even when MSI does not inherit the setup environment.
- The final pristine payload contains no generated registration state. Inventory verification passed after copying the frozen launcher and Japanese README.
- Exact comparison against the passing relocated calculation smoke: 4,548 non-license files, 4,546 unchanged; changed paths are only `INSTALLER-README.md` and `launcher.mjs`. No non-license file was removed. All engine, server, Node, uv and Python project files remain identical. Evidence: `repairfix1-payload-comparison.json`.
- Packaging tests remain 7/7; the runtime teammate and lead independently report 18/18 runtime tests for the receipt fix.
- The artifact, payload and sidecars are frozen. Exact path and SHA were handed to the independent lifecycle verifier for install, `/fa ProductCode` repair, and `/x ProductCode` uninstall without repeating the custom path. Lifecycle result pending at this entry.

## Superseded First Artifact (Do Not Distribute)

Independent lifecycle testing found that Windows Installer `/fa` ignored the supplied `INSTALLFOLDER` and restored files into the default location. The first artifact is preserved only as failure evidence; its adjacent `DO-NOT-DISTRIBUTE.txt` marks this limitation. It is not the final deliverable.

- MSI: `C:/Users/sasai/Documents/structural-mcp/.structural-mcp/installer-work/20261016-185314-f5507b34/msi/structural-mcp-0.2.0-preview-win-x64.msi`
- SHA-256: `5d5d914280d0474c90fd0e027f3cfde985bda8445029ba6d58c798b0df224779`
- Size: 180,138,752 bytes (approximately 172 MiB).
- ProductCode: `{CE85003A-452D-45B3-A129-E90B0D275775}`.
- UpgradeCode: `{E617F890-6A7D-4BDD-A752-7AC3E7759B28}`.
- Numeric MSI version: `0.2.0`; default version directory: `0.2.0-preview`.
- Sibling sidecars: `.msi.sha256` and `msi-build-manifest.json`; staged `release-manifest.json` records every payload file and the initial/final source snapshots.
- The artifact is unsigned. No clean-VM acceptance or redistribution entitlement is claimed. The independent teammate owns actual install/repair/uninstall verification of this exact frozen MSI.

## Communication with Teammates

- Launcher: agreed on root launchers, bundled Node/uv, server dependencies, runner paths, and FEMPython ancestor discovery; integrated the final runtime files and verified its review fixes.
- Launcher: addressed provenance overwrite, canonical path containment, and executing staged Node before its integrity check; the teammate independently reran the seven packaging tests successfully.
- Documentation/review: shared payload layout, build interface, license limitations and observed advisory URLs; included the final Japanese installer README, and supplied the frozen MSI/hash for lifecycle verification.
- Lead: coordinated immutable payload handoff, confirmed relocated bootstrap and all three actual-engine calculations passed, and proved notice-only changes preserve every tested non-license byte.

## Issues Encountered

- NuGet NU1005: existing source lockfiles reject disabling lockfile support at their default paths. Resolved by pointing the build to an unused ignored lockfile path without modifying tracked locks; full corrected build passed.
- WiX WIX0230: file/HKCU components do not support automatic GUIDs. Resolved with deterministic UUIDv5 components.
- WiX WIX0103: a long NuGet notice path exceeded the supported path limit. Resolved with short notice directories; final payload integrity rechecked and runtime byte agreement independently established.
- The first build's PowerShell ZIP extraction was slow. Replaced by verified-entry .NET ZIP extraction; the full fresh build succeeded.
- Independent MSI lifecycle found a maintenance-location defect: custom-path installation passed all hashes, but repair without a persisted directory wrote into the default location. `Product.wxs` now stores the version-specific directory in HKCU, restores it after AppSearch before costing, and exposes it through ARPINSTALLLOCATION. The registry-only component GUID derives from its version-specific key path. Verification must use `/fa ProductCode` and `/x ProductCode` without repeating the install path.
- A separate lifecycle finding showed that MSI unregister must not depend on inheriting the setup shell's CODEX_HOME. The runtime teammate is adding validated install-local registration state; the revised package will integrate that change before lifecycle retesting.
- Added a validated `-ArtifactSuffix` output selector and fail-if-exists guard so corrected artifacts cannot overwrite the frozen failure evidence. Packaging tests remain 7/7 after the maintenance fix; PowerShell and XML parse checks passed.
- Existing `SixLabors.ImageSharp 2.1.13` emits NU1902/NU1903 warnings; these remain recorded preview limitations, with no unrelated solver dependency edits.

## Sources Consulted

- WiX 5.0.2 official release: https://www.firegiant.com/blog/2024/10/4/wix-v406-and-v502-have-been-released/
- Pinned WiX SDK: https://www.nuget.org/packages/WixToolset.Sdk/5.0.2
- WiX maintenance fee history: https://docs.firegiant.com/wix/osmf/
- Node checksums: https://nodejs.org/dist/v24.22.0/SHASUMS256.txt
- uv checksum: https://github.com/astral-sh/uv/releases/download/0.10.0/uv-x86_64-pc-windows-msvc.zip.sha256
- .NET runtime metadata: https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json and https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json
- Windows Installer repair command properties: https://learn.microsoft.com/en-us/windows/win32/msi/command-line-options
- WiX registry search and property scheduling: https://docs.firegiant.com/wix/schema/wxs/registrysearch/ and https://docs.firegiant.com/wix/schema/wxs/setproperty/
