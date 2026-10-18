# Work Log: Launcher implementer

## Summary
Implemented the installed Windows setup, runtime readiness checks, and conservative Codex registration lifecycle. Registration works without Codex CLI and only follows successful Python bootstrap and actual MCP health checks.

## Tasks Completed
- [x] Added bundled-node CMD entry points for setup, health, and unregister, plus an optional PowerShell wrapper.
- [x] Added pinned Python 3.12.12 / uv locked bootstrap into the installed FrameWeb `.venv`, with isolated configurable downloads/cache and visible progress.
- [x] Added Python import checks, executable protocol probes, and actual MCP SDK connect/list/get_capabilities checks before registration.
- [x] Added TOML parsing with preservation of unrelated original bytes, exclusive writer lock, adjacent temporary file + atomic rename, concurrent editor detection, and no automatic overwrite of unrelated registration.
- [x] Added ownership-checked unregister and explicit older installer-version replacement; absent Codex configuration is a no-op.
- [x] Added isolated tests for Unicode/space paths, conflicts, malformed/invalid UTF-8 input, markers, concurrent writers, failure/retry, timeout settings, runtime SDK imports and CMD argument/exit propagation.

## Files Modified
- `installer/runtime/package.json`, `package-lock.json`
- `installer/runtime/codex-config.mjs`, `launcher.mjs`
- `installer/runtime/setup.cmd`, `health.cmd`, `unregister-codex.cmd`, `structural-mcp.ps1`
- `installer/tests/runtime.test.mjs`

## Test Execution Results
- `npm ci --ignore-scripts --prefix installer/runtime`: passed; one pinned parser dependency, audit reported no vulnerabilities.
- `node --test installer/tests/runtime.test.mjs`: 12 passed, 0 failed, 0 skipped (Windows).
- Tests only used isolated temporary CODEX_HOME/config and data paths. The real user Codex configuration was not modified.
- Actual staged Python bootstrap and full engineering calculations are integration checks delegated to packaging/docs_review/root, not claimed by the unit/runtime suite.

## Communication with Teammates
- → packaging: agreed payload layout, root npm runtime dependency installation, CMD shortcut names, CLI flags and quiet unregister.
- ← packaging: confirmed root/runtime and server dependency staging, self-contained engine locations and fixed Python version.
- → docs_review: provided stable server SDK path, exported createLayout/registrationFor contract and current CLI wrapper flags.
- ← root: keep src untouched, gate registration on successful bootstrap/readiness, preserve existing user data and configuration.
- → root: reported 12 passing tests, including actual MCP and Windows wrapper argument coverage.

## Issues Encountered
- Capacita's no-argument error engine identifier differs from its normal protocol identifier; health uses its real `capabilities` command instead. FEMPython and SoilStructure do not offer capabilities commands, so their expected input-error envelopes prove process startup while separate calculation smoke verifies numerical execution.
- Initial CMD-to-PowerShell forwarding did not match GNU-style CLI flags; wrappers now launch bundled Node directly and use `STRUCTURAL_MCP_NO_PAUSE=1` for automation.
- No signing certificate is available. Launchers remain unsigned; CMD setup does not change PowerShell execution policy.
- Removed an overbroad legacy `js2py` import from the readiness probe after reproducing its bytecode incompatibility on Python 3.12.12. The actual backend imports (`fem`, NumPy, SciPy, Flask) remain checked; no source uses js2py and no dependency or solver implementation was changed.

## Independent Packaging Review Scope
- Read-only review of `installer/build/**` and `installer/packaging/**`, including MSI scope/custom action, safe source preservation, manifest integrity, StagePath containment and runtime layout.
- Three Medium findings were sent to packaging/root and fixed by packaging: preserve initial vs final provenance, canonicalize StagePath against junction escape, and verify staged binaries with build-host Node before execution.
- Re-read the fixes and independently ran updated packaging tests: 7 passed, 0 failed. No source-reset/recursive-cleanup operation or author-specific runtime path was found.
- Clean-VM MSI install/repair/upgrade/uninstall and actual staged engine calculations remain separate acceptance checks; this source review does not imply they passed.

## MSI Lifecycle Follow-up
- The actual MSI cleanup log showed the original installation executable was invoked, but Windows Installer did not deliver the caller's temporary CODEX_HOME to it; the isolated registration remained. The real Codex config hash was unchanged.
- With root approval, added an atomic install-local `codex-registration-state.json` receipt after successful registration. Unregister chooses an explicit `--codex-home`, otherwise the validated saved location, otherwise the normal environment/default location. Malformed or wrong-install receipts fail closed; original exact-path ownership checks remain in place.
- Matching successful unregister removes its receipt. Only the most recently successfully registered config location is automatically remembered; additional locations use explicit `--codex-home` cleanup.
- A registration conflict preserves the previous receipt. Receipt-write failure clearly reports that Codex registration itself succeeded and explains how to retry or manually unregister.
- Runtime suite after this fix: **18 passed, 0 failed**, including changed/lost service environment, explicit override precedence, malformed receipts, conflict preservation, write-failure diagnostics and unowned-config protection.
- Only `installer/runtime/launcher.mjs` changed in the installed runtime; no solver rebuild is necessary. Packaging and docs_review were asked to refresh launcher/manifest/MSI and use the registration action in the lifecycle fixture.
