# Windows installer test review

Review date: 2026-10-16. Coverage was not measured; no percentage is claimed.

## Reviewed coverage

The original 12 runtime tests cover new registration, exact preservation of unrelated configuration bytes, Japanese/spaced paths, idempotent registration, ownership-restricted removal, explicitly replacing an older managed version, malformed or invalid UTF-8 configuration, embedded/ambiguous management markers, concurrent setup locks, network/bootstrap failures, health failure after a download, and the real CMD wrapper. The corrected launcher expands this to 18 tests, including saved registration-target behavior; the parent independently reran all 18 successfully. The SDK test connects to the real MCP server but uses fake engine runners.

The source gateway baseline `npm test` passed 31 tests. It covers protocol and artifact boundaries but does not replace real engine testing.

## Added payload acceptance helper

`node installer/verify/payload-smoke.mjs --payload <absolute-payload> --initialize --relocate` verifies:

- Every manifest-listed file's size and SHA-256 before initialization.
- Relocation to a new path containing Japanese text and spaces, without copied `.venv` or `__pycache__` folders.
- Bundled Node and self-contained .NET runners with only Windows system directories on PATH and nonexistent `DOTNET_ROOT` / `DOTNET_ROOT_X64`.
- Python version/import checks from setup, plus explicit interpreter, base prefix, and fem / numpy / scipy module locations inside the destination payload or isolated download directory.
- Actual MCP initialization and tool listing, Capacita RC and SoilStructure calculation PDFs, FEMPython PDF / PIK / displacement CSV / reaction CSV, artifact byte counts / SHA-256, and a cantilever axial displacement oracle of 0.0004.
- Allowed-root rejection and malformed JSON rejection.

Each run uses a new data directory and `CODEX_HOME`; it does not write the real Codex configuration. Evidence and generated jobs remain in the printed temporary work directory. The helper accepts extracted MSI payloads as well as pre-MSI staging. The helper's `--skip-fempython` mode is a partial diagnostic only, not full acceptance.

## Remaining acceptance boundaries

The parent completed actual relocation smoke with exit 0. Evidence was independently inspected and retained at `.structural-mcp/installer-work/root-verification/payload-relocation-20261016-NTYSrf.json`: 4,999 static files, all three calculations and nine artifacts passed; Python locations stayed inside the isolated installation/data root; the numerical oracle and rejection cases passed. Final MSI notices were subsequently relocated to shorter paths without changing executable files.

Packaging independently compared the tested relocation manifest with the first MSI stage: 4,548 non-license files had identical hashes, `changedNonLicenseFiles=[]`, exit 0. The repairfix1 stage later changed only `launcher.mjs` and `INSTALLER-README.md` among those non-license files; the launcher passed its expanded 18-test suite. Packaging verified unchanged engine/server/runtime inputs, so the real engine acceptance remains applicable.

The docs_review agent owns per-user MSI install / repair / uninstall validation using `installer/verify/msi-lifecycle.ps1`. Upgrade remains untested. A run on this developer PC is not a clean-VM result. Signing and redistribution checks are not tested by these commands. Excel COM automation is not exercised by the payload smoke, which uses native PDF generation and `generateExcel: false`.

## Test execution results by this reviewer

| Command | Exit | Result |
|---|---:|---|
| `npm test` | 0 | 31 passed |
| `node --test installer/tests/*.test.mjs` | 0 | 12 passed |
| `node --check installer/verify/payload-smoke.mjs` | 0 | Syntax valid |
| `git diff --check -- README.md .gitignore installer` | 0 | No whitespace errors |
| `powershell -NoProfile -ExecutionPolicy Bypass -File installer/build/build-installer.ps1 -Preview -SkipMsi` | 0 | Packaging-agent reported complete rebuild from current scripts; output `.structural-mcp/installer-work/20261016-191430-629c459b/payload` |

## Initial MSI lifecycle result

`powershell -NoProfile -ExecutionPolicy Bypass -File installer/verify/msi-lifecycle.ps1 -MsiPath <initial-msi> -ExpectedSha256 5d5d914280d0474c90fd0e027f3cfde985bda8445029ba6d58c798b0df224779` exited 1. MSI install / repair / cleanup-uninstall each exited 0, but repair placed the missing README at the default directory; all 4,999 files had passed the initial installed integrity check. The isolated registration was not removed by the original hook. Real Codex config stayed byte-identical by SHA-256. Detailed evidence is retained under `.structural-mcp/installer-work/root-verification/msi-lifecycle-20261016-192239-243801b9/`.

The repair-created default tree was separately audited: 4,999 expected files plus the manifest, no extra files/symlinks, all hashes valid, manifest identical to the rejected MSI's staged manifest, and exactly 5,000 `No existing file` lines in the repair log. Cleanup completed through that original MSI: reinstall and uninstall each exited 0; neither test installation directory nor a related product remained. The real Codex configuration hash stayed unchanged. Evidence: `orphan-cleanup.json` and the adjacent MSI logs in the failed lifecycle work directory. No unbounded directory deletion was used.

For the corrected artifact, the lifecycle verifier uses `/fa <ProductCode>` and `/x <ProductCode>` without an install-directory override, rejects any preexisting related product or default directory, and checks that repair does not create a default directory. Its fixture calls the real registration action with only initialization stubbed, asserts the saved target receipt, and changes the current CODEX_HOME before uninstall to verify receipt-based cleanup. All installed manifest hashes remain checked, now by a hash-verified bundled Node process with bounded concurrent file reads.

## Corrected MSI lifecycle result and configuration guard

The exact command was:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer/verify/msi-lifecycle.ps1 -MsiPath '.structural-mcp/installer-work/20261016-185314-f5507b34/msi-repairfix1/structural-mcp-0.2.0-preview-repairfix1-win-x64.msi' -ExpectedSha256 'add364c02ae155f70613bfd8f74270dc7c714cc147b56c4b09ef5cf562df160e'
```

The helper exited **1**, retained truthfully in `msi-lifecycle-20261016-194901-b18989f3/lifecycle.json`, because its real-Codex whole-file hash guard detected a concurrent change. All installer functionality checks passed:

- Install, repair, and uninstall each exited 0. The two complete installed inventory / size / SHA-256 checks each verified 4,999 static files.
- `/fa {BC8F9E5B-D940-4214-81BB-9F7D5CDD485C}` restored the deliberately deleted README at the remembered custom path. No default installation directory was created.
- `/x {BC8F9E5B-D940-4214-81BB-9F7D5CDD485C}` removed the product without any install-path override. No registered related product or installed server remained; the default directory was absent.
- The production saved-target receipt removed the isolated registration despite a different uninstall CODEX_HOME. The isolated config returned to its exact original SHA-256 `d686da2721a398c29d5332be58d5ce8674cff058e04a49b76dbfa4720cfc67ca`, preserving the unrelated development entry.

The real config changed from SHA-256 `daf88ae60c9fc2543d70f3304ea39c07ad5ee1dd6cfd0119f781f4b829d8180c` to `63a6a813fe13b691afe5acdc34758bcd05e1d4ea814a02d49ae3bdbb4ab14f45`. The uninstall hook ended at **19:57:43** local; the real config was atomically recreated at **19:57:51.014** and modified at **19:57:51.015**, after that hook had finished. Read-only parsing confirmed that the existing real structural-mcp entry still used `command = "node"` and `C:\Users\sasai\Documents\structural-mcp\dist\src\index.js`, with no installer management markers. The source performs one config update at the saved receipt target, and the isolated target was restored exactly. These observations support a separate concurrent writer, but its identity is not proven and no complete before/after config diff is available. No real config restoration or modification was attempted by this reviewer. The raw helper result remains exit 1; this is not claimed as an unconditional clean acceptance pass.

Evidence is retained under `.structural-mcp/installer-work/root-verification/msi-lifecycle-20261016-194901-b18989f3/`, including `lifecycle.json`, `install.log`, `repair.log`, `uninstall.log`, and `config-guard-assessment.json`. The final MSI is unsigned and was tested on the developer PC only. Upgrade and clean-VM behavior remain untested.
