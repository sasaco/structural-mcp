# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local STDIO MCP server (Node.js 24, TypeScript, ESM) that exposes four structural-engineering engines and one application to MCP clients (mainly Codex). They live in Git submodules — `FEMPython`, `Capacita`, `SoilStructure`, `Batch` (Aggre-SE / Docu-SE), and `WebPier` (pier design app) — and are **never reimplemented here**: the server spawns each one's non-interactive "headless runner" process and manages its outputs as jobs/artifacts. README.md (Japanese) is the user-facing spec for every tool and env var; keep it in sync when tool behavior changes.

`WebPier` (Python/uv; depends on GridLayoutPdf through a git reference in its `pyproject.toml`) calls the other runners itself: its runner is `WebPier/run_headless.py` (`webpier/pipeline/headless.py`, WebPier decision 61), started with the `.venv` beside it, and the server passes it the paths of the runners it detected. `JRSNAPHeadless` (protocol v1 runner for JRSNAP, a licensed RTRI program installed separately; **private** GitHub repo, so cloning it needs access) is only detected and passed to WebPier — it has no tools of its own. Each has its own CLAUDE.md/README with its rules — follow them when working inside, and commit there (WebPier may be in use by another session: check its branch and status first). The Phase 4 record is `.claude/docs/plans/phase4-webpier-mcp.md`.

## Commands

```powershell
npm ci
npm run build          # tsc -> dist/ (src and tests both compile; rootDir is ".")
npm test               # build, then node --test dist/tests/*.test.js
npm start              # node dist/src/index.js (STDIO server)
```

Tests run from compiled JS in `dist/tests/`, so always build first. Single file / single test:

```powershell
npm run build; node --test dist/tests/artifacts.test.js
npm run build; node --test --test-name-pattern "rejects an input path outside" dist/tests/mcp.test.js
```

`tests/mcp.test.ts` launches the real server over STDIO (`dist/src/index.js`) with the fake runners in `tests/fixtures/` (`fake-runner.mjs` serves both Capacita and SoilStructure; `fake-fempython-runner.mjs` serves FEMPython; `fake-aggrese-runner.mjs` and `fake-webpier-runner.mjs` the others). Runner paths ending in `.mjs/.js/.cjs` are executed with node, `.dll` with `dotnet`, `.py` with the `.venv\Scripts\python.exe -X utf8` beside the script (`runner.ts: runnerInvocation`; a `.py` runner without that venv counts as missing), anything else directly — this is what lets tests avoid real engines.

Real-runner smoke tests (need built submodule runners; see README for arguments): `npm run smoke`, `npm run smoke:soilstructure -- <abs input> pile-excel`, `npm run smoke:fempython -- <input.json> [--exports all|node-csv|displacement|reaction]`. Python verifiers in `scripts/` run via `uv`.

Building real runners (Windows only):

```powershell
dotnet build .\Capacita\WebDanforCS\Headless\WebDanforCS.Headless.csproj -c Release
uv sync --project .\FEMPython\FrameWeb --locked
dotnet build .\FEMPython\FrameWebforCS\Headless\FrameWebforCS.Headless.csproj -c Release
```

Aggre-SE (`Batch`) is .NET Framework 4.8 VB.NET with licensed vendor components (SPREAD, ComponentOne, VB-Report8): build it with Visual Studio MSBuild (`vswhere`), never `dotnet build` — see `Batch/Aggre-SE/Headless/README.md`. Its runner tests are in `Batch/tests/Aggre-SE.Test` (`dotnet test --no-build` after the MSBuild build) and skip when the JRSNAP sample results (`*.DB1`, gitignored) are absent. `npm run smoke:aggrese -- <project.xml>` drives the real runner through MCP. `npm run smoke:webpier -- <input.json>` (the input's `outputs` choose the reports, WebPier decision 72) generates through MCP, runs WebPier's CLI with the same venv/input/runners, and compares the bytes.

Installer (MSI) has its own tests and build: `npm ci --prefix installer/runtime; node --test installer/tests/*.test.mjs` and `installer/build/build-installer.ps1 -Preview`. See `installer/README.md`. The MSI bundles WebPier (its `.venv` is built by setup from `uv.lock`, like FrameWeb's) and the `skills/structural-*` (setup copies them into `~/.claude/skills` and `~/.agents/skills`, `installer/runtime/skills.mjs`); JRSNAPHeadless is not bundled, so WebPier's 0710+ stages are unavailable there. Record: `.claude/docs/plans/phase6-installer.md`.

Agent skills for the engines and WebPier (`structural-webpier`: how to make reports through the `webpier_*` tools; its `scripts/place-webpier-outputs.mjs` copies a job's artifacts into a project after checking `manifest.json`, using `get_capabilities`' `pathPolicy.jobRoot`) live in `skills/structural-*` — the single source, installed user-wide rather than copied into design projects. `npm run skills:install` junctions them into `~/.claude/skills` and `~/.agents/skills` (Codex); `skills:status` / `skills:uninstall` manage them. `tests/skills.test.ts` enforces the rules in `skills/README.md` (no BOM — Codex silently skips such skills; skill-relative `scripts/`/`references/` paths; no machine-specific paths). New engine knowledge goes into `skills/`, not into a project's copy. Plan: `.claude/docs/plans/global-engine-skills-plan.md`.

Server changes only take effect in Codex after rebuilding and starting a **new** Codex session. The dev registration is named `structural-mcp-dev` (separate from the release `structural-mcp`); see `.claude/docs/plans/distribution-and-development-testing-plan.md`.

## Architecture

Request flow for every calculation tool (`src/server.ts` → `calculate()`):

1. **Input** (`inputContents`): exactly one of `inputPath` or inline `input`. Paths are realpath-resolved and must lie under `STRUCTURAL_MCP_ALLOWED_ROOTS` (`jobs.ts: resolveInputPath`); extension and size are checked; JSON inputs get a BOM strip and must be an object.
2. **Job** (`jobs.ts: createJob`): input is copied into `<jobRoot>/<date>/<date>_<uuid>/input/model<ext>`, with an empty `output/` dir. The runner only ever sees the job copy.
3. **Runner** (`runner.ts: runEngine`): spawned with `<command> --input <file> --output-dir <dir> [options]`, `shell:false`, and a **minimal env** (PATH, SystemRoot, DOTNET_ROOT, TEMP, TMP only). stdout must be a single JSON "protocol v1" envelope (`contracts.ts: runnerEnvelopeSchema`); engine name and exit code must agree with `ok`. stdout/stderr size and timeout are bounded.
4. **Artifacts** (`jobs.ts: verifyArtifacts`): every artifact the runner declares is checked for path containment, size, and SHA-256 before being recorded. Specs with `requiredArtifacts` fail if a requested output is missing or if a failed run left partial artifacts.
5. **Manifest**: `manifest.json` is written to the job dir and returned as `structuredContent`. Large results/PDFs are never inlined — clients fetch them with `read_artifact` (Base64 byte ranges) / `read_text_artifact`, then write files themselves.

Key invariants to preserve:
- The server never accepts a client-supplied output path, command, or cwd. Placing files at user destinations is the client's job (after verifying bytes + SHA-256).
- `executionStatus` (did the process work) and `engineeringStatus` (did the design check pass) are separate; `ok: true` with `engineeringStatus: not_ok` is normal.
- Each runner is detected independently in `config.ts`; a missing runner disables only its tools (they return `engine_unavailable`), never the server. SteelDan additionally needs `STRUCTURAL_MCP_ENABLE_STEELDAN=true`.
- User-facing tool messages and descriptions are in Japanese; follow that.

Aggre-SE is the one multi-file input: `aggrese_*` tools set `CalculationSpec.prepareJob` → `jobs.ts: createAggreSeJob`, which copies the Shift-JIS project XML unchanged plus every JRSNAP file sharing each DB1's name (SNAPDBLib unpacks zipped `.R10` etc. from them) into `input/snap/NN/`, checks each against the allowed roots, and passes `--snap-map` (and `--spectral-ductility`) to the runner, which swaps only the DB1 paths in memory. The runner (`Batch/Aggre-SE/Headless`) drives Batch's report classes through `HeadlessHost` (no progress dialogs/MsgBox; GUI behavior unchanged) with all purchasable options enabled, and must keep the C1Zip binding redirect in its `App.config`.

WebPier is the one runner whose contract comes from the runner itself: `webpier_get_contract` / `webpier_get_input_schema` run `run_headless.py contract|schema` (no `--input`/`--output-dir`: `runEngine` takes `null` for both) and add which output items (the input's `outputs`, WebPier decision 72: the only thing that chooses the stages; the tools take no stage argument) the detected runners can generate. `webpier_validate` / `webpier_generate` copy the input byte for byte under its own name (`jobs.ts: createNamedJsonJob`; WebPier records the input's name and SHA-256), pass only the detected runner paths in the environment (`server.ts: webPierEnvironment`; Capacita's `.dll` as its `.exe`), and `webpier_generate` uses `STRUCTURAL_MCP_WEBPIER_TIMEOUT_MS` (`CalculationSpec.timeoutMs`). Its artifacts keep WebPier's `output/`/`post/` layout under the job output, with WebPier's roles as kinds (`0612-pdf`; a JRSNAP folder's files `0711-jrsnap`, `0711-jrsnap-2`, …).

Other non-calculation tools return static contracts: `soilstructure-contract.ts` (JSON Schema v1 for SoilStructure documents + standalone-runner contract/Python template) and `fempython-contract.ts` (PDF section IDs + FrameWebforCS runner contract). `get_environment_template` emits a dotenv for client scripts that call runners directly.

### Adding or changing a tool

A new runner command/tool typically touches all of: the `RunnerCommand` union in `runner.ts`, the `JobManifest.tool` union in `contracts.ts`, the `registerTool` + `CalculationSpec` in `server.ts`, the tool-list assertion and a scenario in `tests/mcp.test.ts`, the fake runner in `tests/fixtures/`, and the README tool table. The real runner change lives in the corresponding submodule. A new engine also needs `config.ts` (runner env var/default path), `get_capabilities`/`get_environment_template`, and the installer (`build-installer.ps1`, `payload.mjs` provenance, `runtime/launcher.mjs` runners/registration/health, `verify/payload-smoke.mjs`).

## Naming and submodules

- `webdan` / `webdan2` / `STRUCTURAL_MCP_WEBDAN_RUNNER` are legacy names for **Capacita** (RC core `RcDan`, steel `SteelDan`, app `WebDanforCS`). They are kept for compatibility — don't rename tool IDs, env vars, or the `webdan2` engine name.
- Default runner paths (in `config.ts`) point into the submodules' Release build outputs relative to the repo root (resolved from `dist/src/`).
- Submodules are pinned to verified commits. Changes inside a submodule must be committed there and the root pointer updated (`git submodule update --init --recursive` to sync).
