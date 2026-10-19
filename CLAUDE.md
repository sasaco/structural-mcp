# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local STDIO MCP server (Node.js 24, TypeScript, ESM) that exposes four structural-engineering engines to MCP clients (mainly Codex). The engines live in Git submodules — `FEMPython`, `Capacita`, `SoilStructure`, `Batch` (Aggre-SE / Docu-SE) — and are **never reimplemented here**: the server spawns each engine's non-interactive "headless runner" process and manages its outputs as jobs/artifacts. README.md (Japanese) is the user-facing spec for every tool and env var; keep it in sync when tool behavior changes.

`WebPier/` is an untracked, unrelated project in the working tree (it has its own CLAUDE.md). Ignore it unless asked.

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

`tests/mcp.test.ts` launches the real server over STDIO (`dist/src/index.js`) with the fake runners in `tests/fixtures/` (`fake-runner.mjs` serves both Capacita and SoilStructure; `fake-fempython-runner.mjs` serves FEMPython). Runner paths ending in `.mjs/.js/.cjs` are executed with node, `.dll` with `dotnet`, anything else directly — this is what lets tests avoid real engines.

Real-runner smoke tests (need built submodule runners; see README for arguments): `npm run smoke`, `npm run smoke:soilstructure -- <abs input> pile-excel`, `npm run smoke:fempython -- <input.json> [--exports all|node-csv|displacement|reaction]`. Python verifiers in `scripts/` run via `uv`.

Building real runners (Windows only):

```powershell
dotnet build .\Capacita\WebDanforCS\Headless\WebDanforCS.Headless.csproj -c Release
uv sync --project .\FEMPython\FrameWeb --locked
dotnet build .\FEMPython\FrameWebforCS\Headless\FrameWebforCS.Headless.csproj -c Release
```

Aggre-SE (`Batch`) is .NET Framework 4.8 VB.NET with licensed vendor components (SPREAD, ComponentOne, VB-Report8): build it with Visual Studio MSBuild (`vswhere`), never `dotnet build` — see `Batch/Aggre-SE/Headless/README.md`. Its runner tests are in `Batch/tests/Aggre-SE.Test` (`dotnet test --no-build` after the MSBuild build) and skip when the JRSNAP sample results (`*.DB1`, gitignored) are absent. `npm run smoke:aggrese -- <project.xml>` drives the real runner through MCP.

Installer (MSI) has its own tests and build: `npm ci --prefix installer/runtime; node --test installer/tests/*.test.mjs` and `installer/build/build-installer.ps1 -Preview`. See `installer/README.md`.

Agent skills for the engines (and, per the plan, WebPier) live in `skills/structural-*` — the single source, installed user-wide rather than copied into design projects. `npm run skills:install` junctions them into `~/.claude/skills` and `~/.agents/skills` (Codex); `skills:status` / `skills:uninstall` manage them. `tests/skills.test.ts` enforces the rules in `skills/README.md` (no BOM — Codex silently skips such skills; skill-relative `scripts/`/`references/` paths; no machine-specific paths). New engine knowledge goes into `skills/`, not into a project's copy. Plan: `.claude/docs/plans/global-engine-skills-plan.md`.

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

Non-calculation tools return static contracts: `soilstructure-contract.ts` (JSON Schema v1 for SoilStructure documents + standalone-runner contract/Python template) and `fempython-contract.ts` (PDF section IDs + FrameWebforCS runner contract). `get_environment_template` emits a dotenv for client scripts that call runners directly.

### Adding or changing a tool

A new runner command/tool typically touches all of: the `RunnerCommand` union in `runner.ts`, the `JobManifest.tool` union in `contracts.ts`, the `registerTool` + `CalculationSpec` in `server.ts`, the tool-list assertion and a scenario in `tests/mcp.test.ts`, the fake runner in `tests/fixtures/`, and the README tool table. The real runner change lives in the corresponding submodule. A new engine also needs `config.ts` (runner env var/default path), `get_capabilities`/`get_environment_template`, and the installer (`build-installer.ps1`, `payload.mjs` provenance, `runtime/launcher.mjs` runners/registration/health, `verify/payload-smoke.mjs`).

## Naming and submodules

- `webdan` / `webdan2` / `STRUCTURAL_MCP_WEBDAN_RUNNER` are legacy names for **Capacita** (RC core `RcDan`, steel `SteelDan`, app `WebDanforCS`). They are kept for compatibility — don't rename tool IDs, env vars, or the `webdan2` engine name.
- Default runner paths (in `config.ts`) point into the submodules' Release build outputs relative to the repo root (resolved from `dist/src/`).
- Submodules are pinned to verified commits. Changes inside a submodule must be committed there and the root pointer updated (`git submodule update --init --recursive` to sync).
