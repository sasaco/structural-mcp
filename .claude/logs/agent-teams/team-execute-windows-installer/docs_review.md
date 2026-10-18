# Work Log: docs_review

## Summary

Prepared Japanese installer instructions, a real-payload verification helper and fixtures, and an independent runtime/packaging review. Existing engine source changes were inspected but not edited.

## Tasks Completed

- [x] Investigated Python environment discovery and packaging resources. Reported the required sibling FrameWeb / FrameWebforCS layout, destination-created virtual environment, SoilStructure Excel template / font notice, and embedded font / commercial package distribution review requirements.
- [x] Added staged/extracted payload verification with relocation, strict isolated runtime paths, actual MCP calculation calls, artifact hashes, a FEMPython numerical oracle, and rejection checks.
- [x] Added Japanese MSI install/build/troubleshooting documentation and linked it from the repository README.
- [x] Independently reviewed runtime configuration safety and packaging behavior; recorded review scope, test evidence, and release limits.
- [x] Ran baseline and runtime regression tests. Actual relocated calculation execution is assigned to the parent agent to avoid duplicate expensive runs; this reviewer owns MSI lifecycle execution.

## Files Modified

- `installer/README.md`: install/setup/check/removal instructions, preview build commands and limitations.
- `installer/verify/payload-smoke.mjs`: integrity, relocation, dependency isolation, Python path, real engine and artifact checks.
- `installer/verify/fixtures/fempython.json`: existing headless-test cantilever with known axial displacement 0.0004.
- `installer/verify/fixtures/soilstructure.json`: copy of the existing valid SoilStructure feature fixture.
- `installer/verify/fixtures/capacita.wdj`: copy of existing Capacita TestFile03_H16JREast_Rec_Manual WDJ.
- `README.md`: installer entry point before source-development instructions.
- `.gitignore`: generated WiX bin / obj directories.
- `installer/verify/msi-lifecycle.ps1`: bounded, isolated per-user MSI install / repair / uninstall with before/after real config hashes and retained MSI logs.
- `installer/verify/manifest-integrity.mjs`: complete fixed-file integrity / inventory verification; the lifecycle option permits only the expected generated registration receipt.
- `installer/verify/create-registration-fixture.mjs`: real registration action with initialization stubbed, preserving an unrelated development entry and creating the saved-target receipt.
- `.agents/docs/research/review-quality-windows-installer.md`: independent runtime/packaging review.
- `.agents/docs/research/review-tests-windows-installer.md`: coverage and evidence boundaries.

## Key Decisions

- Kept source trees and real Codex configuration untouched. The verifier imports the same staged registration layout used by the installer and uses a temporary isolated CODEX_HOME / data / input root.
- Verified the pre-initialization manifest, then initialized the relocated environment instead of copying an existing `.venv`.
- Preserved test outputs for inspection in a new temporary directory; no recursive cleanup of user directories.
- Documented unsigned preview, unverified redistribution rights, lack of clean-VM evidence, and file-based readiness as actual limits rather than claiming release readiness.

## Test Execution Results

- `npm test`: exit 0; 31 passed, 0 failed.
- `node --test installer/tests/*.test.mjs`: exit 0; 12 passed, 0 failed.
- `node --check installer/verify/payload-smoke.mjs`: exit 0.
- `git diff --check -- README.md .gitignore installer`: exit 0.
- Coverage percentage not measured. The repository-local `.agents/check.ps1` and shared workspace helper were absent; no result for them is claimed.
- Real relocated payload smoke: parent completed exit 0; this reviewer inspected all three engine results and nine artifacts in `.structural-mcp/installer-work/root-verification/payload-relocation-20261016-NTYSrf.json`.

## Lifecycle defect reproduction and retest preparation

- Original MSI lifecycle exited 1 although install / repair / cleanup-uninstall each exited 0. Repair restored to the default location rather than the requested custom location. The original hook did not remove the isolated custom Codex registration. The artifact is retained as rejected evidence, not for distribution.
- Proved the repair-created default tree consisted exclusively of old MSI-owned files by complete hash/inventory comparison and repair logs, then removed it through MSI reinstall / uninstall (both exit 0). No related product or install directory remains; the real Codex configuration SHA-256 remained unchanged.
- Packaging now remembers the actual install location for maintenance. Launcher records the last successful Codex config target in a validated receipt; its expanded 18-test suite passed in the launcher and parent runs.
- Revised lifecycle uses `/fa ProductCode` and `/x ProductCode` without install-path overrides, validates the production receipt, changes CODEX_HOME before uninstall, and rejects unexpected default-path writes.

## Final revised lifecycle execution

- Tested immutable `structural-mcp-0.2.0-preview-repairfix1-win-x64.msi`, SHA-256 `add364c02ae155f70613bfd8f74270dc7c714cc147b56c4b09ef5cf562df160e`. Evidence: `.structural-mcp/installer-work/root-verification/msi-lifecycle-20261016-194901-b18989f3/`.
- Install / repair / uninstall each exited 0. Both complete installed checks verified all 4,999 files. The missing README was restored at the saved custom path; no default path was created; no related product or installed server remained after uninstall.
- The production receipt restored the isolated Codex config exactly even with a different current CODEX_HOME, preserving its unrelated development entry.
- Overall helper exited **1** because the real config whole-file hash changed. Its atomic recreation at 19:57:51 was eight seconds after the hook ended, while its structural-mcp command/path remained the development registration and no installer markers appeared. Source and timing evidence support a separate concurrent writer, whose identity was not proven. No config rollback was attempted and the raw exit 1 result remains preserved.
- Final review reports record passing functionality separately from the whole-file guard anomaly and retain clean-VM / signing / upgrade / dependency limitations. No further source or MSI rebuild was performed after acceptance execution.

## Communication with Teammates

- → packaging / launcher: Python loader constraints, license/resource findings, expected verifier paths and metadata contract.
- ← packaging / launcher: final staged file layout, command-line interface, guarded MSI uninstall hook and shortcut names.
- → parent: baseline/runtime test results, verifier command, safety review results and release limitations.
- ← parent: keep real Codex config untouched, require actual relocated calculation tests, and avoid duplicate full smoke execution.

## Issues Encountered

- Initial PowerShell reads used legacy encoding and displayed Japanese text incorrectly; subsequent reads explicitly used UTF-8. No source encoding was changed by that read.
- CMD entry points changed while reviewed; instructions were synchronized to final direct-Node `--allowed-root` / `--replace-existing` flags and rerun against the actual Windows wrapper test.
- Clean VM, code-signing certificate, commercial package entitlements and embedded-font redistribution rights were not available for verification; these remain explicit preview limitations.
