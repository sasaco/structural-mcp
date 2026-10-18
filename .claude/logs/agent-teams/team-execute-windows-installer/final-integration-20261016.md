# Windows installer integration result — 2026-10-16

Delivery is an unsigned Windows x64 preview for Codex.

Artifact: `.structural-mcp/installer-work/20261016-185314-f5507b34/msi-repairfix1/structural-mcp-0.2.0-preview-repairfix1-win-x64.msi`

SHA-256: `add364c02ae155f70613bfd8f74270dc7c714cc147b56c4b09ef5cf562df160e`.
Size: 180,147,088 bytes. Root independently verified the hash and NotSigned status.

## Verification

- Existing gateway tests: 31 passed (docs reviewer).
- Packaging tests: 7 passed (author and independent reviewer).
- Revised runtime tests: 18 passed (author and root independently).
- Full corrected payload build completed successfully; MSI compilation and enabled validation completed with 0 errors. Known per-user/same-version upgrade validation warnings were not suppressed.
- Relocated payload at a Japanese/spaced path passed isolated Python bootstrap, MCP discovery, Capacita/SoilStructure/FEMPython real calculations, PDF/PIK/CSV retrieval and hashes, a FEMPython displacement oracle, and invalid input rejection.
- Compared with that calculation smoke, final payload changes only `launcher.mjs` and `INSTALLER-README.md` among 4,548 non-license files. All 4,546 others, including engines/server/Node/uv, are identical.
- Revised MSI install, repair, and uninstall each returned 0. All 4,999 fixed files matched after install and repair. Repair restored the deleted README at the remembered custom directory without an INSTALLFOLDER override and did not create the default directory.
- Uninstall with a different CODEX_HOME removed the saved-target fixture registration, restored unrelated fixture bytes exactly, and left no registered product, installed server, or default install directory.

## Concurrent configuration-write warning

The lifecycle helper returned 1 solely because its whole-file real Codex config hash guard detected a concurrent change. Preserve that original result; do not describe the helper as exit 0.

The uninstall hook ran at 19:57:42–19:57:43 JST and restored only its isolated receipt target. The real config was atomically recreated at 19:57:51.015, after the hook ended. A separate global Codex CLI process started at 19:57:43.971. The current real `structural-mcp` entry still uses `node` and the original development `dist/src/index.js`, with no installer-managed markers. This is evidence of a separate writer; Codex startup/normalization is an inference, not proven process-level attribution. No real config restore or edit was performed.

Before hash: `daf88ae60c9fc2543d70f3304ea39c07ad5ee1dd6cfd0119f781f4b829d8180c`.
After hash: `63a6a813fe13b691afe5acdc34758bcd05e1d4ea814a02d49ae3bdbb4ab14f45`.

Evidence: `.structural-mcp/installer-work/root-verification/msi-lifecycle-20261016-194901-b18989f3/lifecycle.json` and the adjacent MSI logs. Real calculation evidence is `root-verification/payload-relocation-20261016-NTYSrf.json`.

## Scope and remaining limits

The first MSI was rejected after real lifecycle testing; its custom-location repair and service-environment registration-target defects were corrected. The old artifact remains marked DO-NOT-DISTRIBUTE. Its test installations and orphan files were removed through MSI, with evidence retained.

This developer-PC test does not certify a clean different PC/VM, upgrade, Excel COM reports, signing, reproducible NuGet transitive resolution, commercial component/font redistribution rights, or resolution of existing ImageSharp 2.1.13 advisory warnings. Those preview limitations are documented in `installer/README.md`.

Existing dirty submodules and untracked WebPier were preserved. No commit, push, or publication was performed.
