# Windows installer quality review

Review date: 2026-10-16. Reviewer: docs_review. Scope: `installer/runtime/{launcher,codex-config}.mjs`, CMD / PowerShell entry points, `installer/build/{build-installer.ps1,payload.mjs}`, `installer/packaging/Product.wxs`, and payload verifier. Existing engine changes were read but not edited.

## Findings

No unresolved high-severity configuration preservation issue was found in the reviewed implementation. The installer-managed TOML block is parsed before editing, unrelated TOML is compared semantically and preserved textually, invalid UTF-8 / TOML and ambiguous markers fail without replacing the configuration. Locking, temporary-file flush/rename, and an original-byte recheck protect concurrent setup operations. Registration replacement and removal require the expected bundled Node and server path; an unrelated or development MCP entry is retained.

The MSI uninstall hook is scoped to full removal, excluded from upgrade removal, calls only `unregister-codex --quiet`, and ignores cleanup failure so an unparseable configuration does not block file removal. Source review does not substitute for executing the generated MSI; this reviewer owns isolated lifecycle acceptance and the parent agent owns real calculation acceptance.

The Python loader was checked against `FEMPython/FrameWebforCS/calculation/PythonEnvironment.cs`. The staged sibling `FrameWeb` / `FrameWebforCS` layout and destination-created `.venv/pyvenv.cfg` are necessary. Copying an already-created `.venv` between PCs is unsuitable. The verifier copies a pristine payload and initializes it at a Japanese/space-containing destination, with development runtime environment variables removed.

## Known release limitations

- Actual Capacita publish reported NU1903 / NU1902 for existing `SixLabors.ImageSharp 2.1.13`: GHSA-j3p4-wp97-rph4, GHSA-j9gm-c75j-xc9q, GHSA-jjfr-hcj7-qf5w (High), GHSA-gwg2-r3hj-4w44, GHSA-wmxv-xphr-5c9g (Medium). These existing engine dependencies were not updated by the installer change. Original build warnings and links in the README remain visible; this is a release limitation, not a clean security bill.
- `get_capabilities` still uses runner-file availability. It does not expose the planned Python `initialization_required` state; setup / health imports Python and gates registration instead. README explicitly documents this limit.
- Existing GrapeCity Spread, EPPlus, and embedded MS Gothic / MS Mincho / SimSun distribution rights were not verified. Existing licenses were not changed. The package is an unsigned preview, with notices and a dependency inventory rather than an assertion of redistribution rights.
- NuGet transitive resolutions are recorded but are not all frozen by committed restore locks. Clean-VM acceptance, signing, and verified reproducibility remain release work.
- Setup/download state, generated `.venv`, and external jobs/cache survive removal as documented.

## Validation performed by this reviewer

- `npm test`: exit 0; 31 passed, 0 failed. These protocol tests use fake runner fixtures and are not evidence of actual engine calculations.
- `node --test installer/tests/*.test.mjs`: exit 0; 12 passed, 0 failed. This includes exact TOML preservation, interrupted initialization, stale/other-registration safety, actual SDK STDIO discovery, and CMD invocation with Japanese/space-containing paths.
- `node --check installer/verify/payload-smoke.mjs`: exit 0.
- `git diff --check -- README.md .gitignore installer`: exit 0.

## Real payload acceptance evidence

The parent agent ran `node installer/verify/payload-smoke.mjs --payload <staged-payload> --initialize --relocate` to completion with exit 0. The reviewer inspected `verification.json`, retained at `.structural-mcp/installer-work/root-verification/payload-relocation-20261016-NTYSrf.json`: `ok: true`, 4,999 manifest files verified, all three engine calculations succeeded, and nine artifacts were retrieved and checked (Capacita 2, SoilStructure 2, FEMPython 5). Python and fem / numpy / scipy resolved only within the isolated relocated payload / download directory. The FEMPython displacement oracle, forbidden path and malformed JSON checks passed. Generated jobs remain in `C:\Users\sasai\AppData\Local\Temp\structural-mcp-verify-NTYSrf`. This is evidence on the developer PC, not a clean VM.

The first MSI stage shortened third-party notice paths to satisfy Windows Installer path limits. Packaging compared it against the tested relocation manifest: all 4,548 non-license files had identical SHA-256 values, `changedNonLicenseFiles=[]`, exit 0. The subsequent repairfix1 stage differs only in `launcher.mjs` and `INSTALLER-README.md` (plus notices/manifest and MSI authoring); packaging verified this comparison before compiling it. Engine binaries, server code and bundled Node/Python-project/uv inputs remain the ones that passed the real calculation smoke. The changed launcher has the focused 18-test verification described below. Upgrade is not claimed as tested.

## Initial MSI lifecycle defects and corrections

The first frozen MSI (SHA-256 `5d5d914280d0474c90fd0e027f3cfde985bda8445029ba6d58c798b0df224779`) failed the full lifecycle verifier with exit 1. Installation exited 0 and all 4,999 installed manifest files passed integrity verification. Repair also exited 0, but restored the deliberately removed README at the default LocalAppData location rather than the custom test location. Cleanup uninstall exited 0, leaving no registered product; the default repair-created files required separate MSI-owned cleanup. Evidence: `.structural-mcp/installer-work/root-verification/msi-lifecycle-20261016-192239-243801b9/lifecycle.json` and adjacent logs. This initial artifact is rejected and marked not for distribution.

The isolated owned Codex registration also remained after the old MSI uninstall hook. The real Codex configuration retained SHA-256 `daf88ae60c9fc2543d70f3304ea39c07ad5ee1dd6cfd0119f781f4b829d8180c` throughout that initial run. The corrected package records/restores its install directory for maintenance; the corrected launcher persists the last successful registration target and uses that validated receipt for removal without depending on MSI process environment propagation. The focused runtime suite now has 18 passing tests, independently rerun by the parent.

## Corrected MSI execution

The repaired MSI is `structural-mcp-0.2.0-preview-repairfix1-win-x64.msi`, SHA-256 `add364c02ae155f70613bfd8f74270dc7c714cc147b56c4b09ef5cf562df160e`, 180,147,088 bytes, unsigned. Its install / repair / uninstall operations each exited 0; both 4,999-file integrity checks passed. Normal maintenance without an INSTALLFOLDER override restored the deleted README at the original custom path, created no default installation, and removed the test product. The saved receipt restored the isolated Codex fixture byte-for-byte despite a different current CODEX_HOME. No registered product or installed server remains.

The lifecycle helper nevertheless exited **1** because the real Codex file's overall SHA-256 changed during the run. Evidence under `.structural-mcp/installer-work/root-verification/msi-lifecycle-20261016-194901-b18989f3/` preserves that result. The hook ended at 19:57:43 local; the real config was atomically recreated at 19:57:51.014 / modified at 19:57:51.015. Its structural-mcp command and server path remained the original development registration, and no installer markers appeared. The hook selects exactly one saved config path and successfully restored the isolated fixture. This supports a separate concurrent writer after the hook, but does not identify that writer or prove whole-file preservation. No rollback or real config write was performed by this reviewer. The test report distinguishes the passing installer behavior from this unresolved attribution / whole-file guard limitation; no clean unconditional lifecycle pass is claimed.
