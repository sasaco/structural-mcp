import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { JobManifest } from "./contracts.js";
import {
  createJob,
  loadManifest,
  readArtifact,
  readTextArtifact,
  resolveInputPath,
  saveManifest,
  verifyArtifacts,
} from "./jobs.js";
import { runEngine } from "./runner.js";
import { femPythonPdfSections, femPythonRunnerContract } from "./fempython-contract.js";
import {
  soilStructureDocumentSchema,
  soilStructureExamples,
  soilStructurePythonTemplate,
  soilStructureRunnerContract,
} from "./soilstructure-contract.js";

const sourceShape = {
  inputPath: z.string().min(1).optional().describe("Allowed root内にある入力ファイルの絶対パス"),
  input: z.string().min(1).optional().describe("入力ファイルの内容をinlineで指定"),
};

const rebarSideSchema = z.object({
  diameter_mm: z.number().int().positive().optional(),
  count: z.number().int().positive().optional(),
  cover_to_center_mm: z.number().finite().nullable().optional(),
  first_row_count: z.number().finite().nullable().optional(),
  row_spacing_mm: z.number().finite().nullable().optional(),
  adjacent_spacing_mm: z.number().finite().nullable().optional(),
  slope_cos: z.number().finite().nullable().optional(),
}).strict();

const webdanComposeRequestSchema = z.object({
  design: z.object({
    application_id: z.number().int().optional(),
    standard_id: z.number().int().optional(),
  }).strict().optional(),
  member: z.object({
    m_no: z.number().int().positive(),
    group_name: z.string().trim().min(1).optional(),
    section: z.object({
      shape: z.literal("rectangle").default("rectangle"),
      width_mm: z.number().finite().positive(),
      height_mm: z.number().finite().positive(),
    }).strict().optional(),
  }).strict(),
  point: z.object({
    index: z.number().int().positive(),
    name: z.string().trim().min(1).optional(),
    axis: z.enum(["My-Vz", "Mz-Vy"]).optional(),
    checks: z.object({
      upper: z.boolean().optional(),
      lower: z.boolean().optional(),
      bending: z.boolean().optional(),
      shear: z.boolean().optional(),
      torsion: z.boolean().optional(),
    }).strict().optional(),
  }).strict(),
  rebar: z.object({ upper: rebarSideSchema.optional(), lower: rebarSideSchema.optional() }).strict().optional(),
  materials: z.object({
    group_no: z.number().finite().optional(),
    longitudinal_grade: z.enum(["SD295", "SD345", "SD390", "SD490"]).optional(),
    concrete: z.object({
      fck_mpa: z.number().finite().positive().optional(),
      max_aggregate_mm: z.number().finite().positive().optional(),
    }).strict().optional(),
  }).strict().optional(),
  forces: z.record(z.string(), z.number().finite().nullable()).optional(),
  calculation: z.object({
    bending: z.boolean().optional(),
    shear: z.boolean().optional(),
    torsion: z.boolean().optional(),
    print_calculation: z.boolean().optional(),
    print_section_forces: z.boolean().optional(),
    print_safety_ratios: z.boolean().optional(),
    print_summary: z.boolean().optional(),
  }).strict().optional(),
}).strict();

interface CalculationSpec {
  tool: JobManifest["tool"];
  engine: JobManifest["engine"];
  runnerPath: string;
  command: "run-rc" | "inspect-rc" | "validate-rc" | "compose-rc" | "run-steel" | "validate" | "run" | "export-sdc" | "run-ground-displacement";
  extensions: readonly string[];
  jobExtension: ".wdj" | ".wsj" | ".json" | ".soilstructure.json";
  runnerOptions: readonly string[] | ((outputDirectory: string) => readonly string[]);
  jsonInput?: boolean;
  requiredArtifacts?: readonly { relativePath: string; mediaType: string }[];
  label: string;
}

function textResponse(value: unknown, summary: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent: value as Record<string, unknown>,
    ...(isError ? { isError: true } : {}),
  };
}

function publicManifest(manifest: JobManifest): Record<string, unknown> {
  return { ...manifest };
}

async function inputContents(
  inputPath: string | undefined,
  input: string | undefined,
  extensions: readonly string[],
  jsonInput: boolean,
  config: AppConfig,
): Promise<string> {
  if ((inputPath === undefined) === (input === undefined)) {
    throw new Error("inputPathまたはinputのどちらか一方だけを指定してください。");
  }
  let contents: string;
  if (input !== undefined) {
    if (Buffer.byteLength(input, "utf8") > config.maxInputBytes) throw new Error("inputがサイズ上限を超えています。");
    contents = input;
  } else {
    const resolved = await resolveInputPath(inputPath!, config);
    if (!extensions.some((extension) => resolved.toLowerCase().endsWith(extension))) {
      throw new Error(`入力ファイルの拡張子は${extensions.join(" または ")}である必要があります。`);
    }
    contents = await readFile(resolved, "utf8");
  }
  if (jsonInput) {
    // UTF-8 files saved by Windows clients may start with a BOM.
    if (contents.startsWith("\uFEFF")) contents = contents.slice(1);
    try {
      const parsed: unknown = JSON.parse(contents);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("root value must be an object");
      }
    } catch (error) {
      throw new Error(`入力は有効なJSON objectではありません: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return contents;
}

async function calculate(
  spec: CalculationSpec,
  inputPath: string | undefined,
  input: string | undefined,
  config: AppConfig,
  transformInput?: (contents: string) => string,
): Promise<ReturnType<typeof textResponse>> {
  const source = await inputContents(inputPath, input, spec.extensions, spec.jsonInput ?? false, config);
  const contents = transformInput?.(source) ?? source;
  const startedAt = new Date().toISOString();
  const job = await createJob(spec.tool, contents, spec.jobExtension, config);
  const envelope = await runEngine(
    spec.runnerPath,
    spec.command,
    spec.engine,
    job.inputPath,
    job.outputDirectory,
    typeof spec.runnerOptions === "function" ? spec.runnerOptions(job.outputDirectory) : spec.runnerOptions,
    config,
  );
  const artifacts = await verifyArtifacts(job.outputDirectory, envelope, config);
  if (spec.requiredArtifacts) {
    if (!envelope.ok && artifacts.length > 0) throw new Error("Failed runner returned partial artifacts");
    if (envelope.ok) {
      if (envelope.executionStatus !== "success") throw new Error("Runner success status is inconsistent");
      for (const required of spec.requiredArtifacts) {
        if (!envelope.artifacts.some((artifact) => artifact.relativePath === required.relativePath &&
            artifact.mediaType.split(";")[0]?.trim().toLowerCase() === required.mediaType && artifact.bytes > 0)) {
          throw new Error(`Runner did not produce required artifact: ${required.relativePath}`);
        }
      }
    }
  }
  const manifest: JobManifest = {
    schemaVersion: 1,
    jobId: job.jobId,
    tool: spec.tool,
    engine: spec.engine,
    engineVersion: envelope.engineVersion,
    readiness: envelope.readiness,
    createdAt: startedAt,
    completedAt: new Date().toISOString(),
    ok: envelope.ok,
    executionStatus: envelope.executionStatus,
    engineeringStatus: envelope.engineeringStatus,
    summary: envelope.summary,
    messages: envelope.messages,
    artifacts,
    errors: envelope.errors,
  };
  await saveManifest(job.directory, manifest);
  const summary = envelope.ok
    ? `${spec.label}が完了しました。jobId: ${job.jobId}`
    : `${spec.label}に失敗しました。jobId: ${job.jobId}`;
  return textResponse(publicManifest(manifest), summary, !envelope.ok);
}

function requestFailure(message: string) {
  return textResponse(
    { ok: false, category: "calculation", errors: [{ code: "request_failed", message }] },
    "計算の実行に失敗しました。",
    true,
  );
}

function unavailable(engine: string, environmentVariable: string) {
  return textResponse(
    {
      ok: false,
      category: "engine_unavailable",
      errors: [{ code: `${engine}_unavailable`, message: `${environmentVariable}に読み取り可能なrunnerを設定してください。` }],
    },
    `${engine}は利用できません。`,
    true,
  );
}

function invalidSourceSelection(inputPath: string | undefined, input: string | undefined) {
  if ((inputPath === undefined) !== (input === undefined)) return null;
  return requestFailure("inputPathまたはinputのどちらか一方だけを指定してください。");
}

export function createServer(config: AppConfig): McpServer {
  const femPythonEnabled = config.femPythonRunner !== null;
  const capacitaEnabled = config.capacitaRunner !== null;
  const soilStructureEnabled = config.soilStructureRunner !== null;
  const steelDanEnabled = capacitaEnabled && config.steelDanEnabled;
  const server = new McpServer(
    { name: "structural-mcp", version: "0.2.0" },
    {
      instructions: "FEMPython、Capacita、SoilStructureを公開する構造計算MCPです。計算前にget_capabilitiesでrunnerの利用可否を確認してください。FrameWebforCSの保存JSONはfempython_calculateのinputへ文字列で渡せます。PIKと入力・断面力・pickup断面力・変位・pickup変位のPDFを生成し、read_artifactで取得した成果物をclient側の指定先へ配置します。standalone利用はfempython_get_runner_contractを参照してください。SoilStructure入力を作る前にsoilstructure_get_schema、standalone scriptを作る前にsoilstructure_get_runner_contractを使用し、不足する設計条件は推測しないでください。入力はsoilstructure_validateへinlineで渡して対象operationごとに検証できます。standalone scriptはrunnerを直接呼び、artifactを検証して指定先へ配置します。executionStatusとengineeringStatusは別々に確認し、MCP計算の成果物はjob単位で扱ってください。",
    },
  );

  server.registerTool("get_environment_template", {
    title: "Get structural-mcp .env template",
    description: "AIが対象プロジェクトの.envを作成するときに使うrunner設定名、推奨絶対パス、読取可否を返します。既存.envや秘密情報は読み取りません。",
    inputSchema: { engine: z.enum(["all", "fempython", "capacita", "soilstructure"]).default("all") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ engine }) => {
    const entries = [
      { engine: "fempython", ...config.runnerConfigurations.femPython },
      { engine: "capacita", ...config.runnerConfigurations.capacita },
      { engine: "soilstructure", ...config.runnerConfigurations.soilStructure },
    ].filter((entry) => engine === "all" || entry.engine === engine).map((entry) => ({
      engine: entry.engine,
      name: entry.environmentVariable,
      value: entry.resolvedPath ?? entry.configuredPath,
      readable: entry.resolvedPath !== null,
      source: entry.source,
    }));
    const content = entries
      .map((entry) => `${entry.name}='${entry.value.replaceAll("'", "''")}'`)
      .join("\n");
    return textResponse({
      schemaVersion: 1,
      fileName: ".env",
      format: "dotenv",
      variables: entries,
      content: `${content}\n`,
    }, `${engine === "all" ? "全runner" : engine}のpathを含む.envテンプレートを返しました。`);
  });

  server.registerTool("get_capabilities", {
    title: "Structural engine capabilities",
    description: "FEMPython、Capacita、SoilStructureの接続状態とrunnerのreadiness・制限を返します。",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => textResponse({
    protocolVersion: 1,
    engines: {
      fempython: {
        enabled: femPythonEnabled,
        readiness: femPythonEnabled ? "experimental" : "unavailable",
        inputFormats: [".json", "inline-json"],
        outputFormats: ["json", "pik", "pdf", "csv"],
        tools: ["fempython_calculate", "fempython_get_runner_contract"],
        defaultPdfSections: femPythonPdfSections,
        pikRequirements: "2次元モデルと計算可能なPICKUP定義が必要です。",
        pickupNodeCsv: {
          displacement: { option: "generatePickupDisplacementCsv", artifact: "pickup-displacement.csv", default: false },
          reaction: { option: "generatePickupReactionCsv", artifact: "pickup-reaction.csv", default: false },
          dimensions: [2, 3],
        },
      },
      capacita: {
        enabled: capacitaEnabled,
        readiness: capacitaEnabled ? "production" : "unavailable",
        compatibilityTool: "webdan_calculate",
        inputFormats: [".wdj", "inline-json"],
        outputFormats: ["wdj", "json", "pdf", "markdown"],
        tools: ["webdan_inspect", "webdan_validate", "webdan_compose_wdj", "webdan_calculate"],
      },
      webdan2: { enabled: capacitaEnabled, readiness: capacitaEnabled ? "production" : "unavailable", aliasFor: "capacita", deprecated: true, outputFormats: ["wdj", "json", "pdf", "markdown"] },
      steeldan: { enabled: steelDanEnabled, readiness: "experimental", outputFormats: ["json", "pdf"] },
      soilstructure: {
        enabled: soilStructureEnabled,
        readiness: soilStructureEnabled ? "production" : "unavailable",
        inputFormats: [".soilstructure.json", ".json", "inline-json"],
        outputFormats: ["json", "pdf", "xlsx", "sdc", "jot"],
        excelRequirements: "Windows、Microsoft Excel、--xlsx-output対応のSoilStructure runnerが必要です。",
        tools: [
          "soilstructure_get_schema",
          "soilstructure_get_runner_contract",
          "soilstructure_validate",
          "soilstructure_calculate",
          "soilstructure_export_sdc",
          "soilstructure_ground_displacement",
        ],
      },
    },
    configurationTool: "get_environment_template",
    pathPolicy: {
      allowedInputRoots: config.allowedInputRoots,
    },
    limits: { timeoutMs: config.timeoutMs, maxInputBytes: config.maxInputBytes, maxArtifactBytes: config.maxArtifactBytes },
  }, `FEMPythonは${femPythonEnabled ? "利用可能" : "利用不可"}、Capacitaは${capacitaEnabled ? "利用可能" : "利用不可"}、SoilStructureは${soilStructureEnabled ? "利用可能" : "利用不可"}です。`));

  server.registerTool("fempython_get_runner_contract", {
    title: "Get FrameWebforCS runner contract",
    description: "FrameWebforCSの非対話runnerのパス、起動引数、PDF項目、PIK形式、変位・反力のPICKUP CSV、成果物の検証とclient側保存の手順を返します。",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const runner = config.runnerConfigurations.femPython;
    return textResponse({
      schemaVersion: 1,
      runner: {
        environmentVariable: runner.environmentVariable,
        path: runner.resolvedPath ?? runner.configuredPath,
        readable: runner.resolvedPath !== null,
        source: runner.source,
      },
      contract: femPythonRunnerContract,
    }, "FrameWebforCS runner contractを返しました。");
  });

  server.registerTool("fempython_calculate", {
    title: "Calculate FrameWebforCS model and export PIK/PDF/CSV",
    description: "FrameWebforCSの保存JSONを再計算し、result.json、任意の2次元PIK・PDF・変位PICKUP CSV・反力PICKUP CSVをjob成果物として返します。CSVは2D/3D対応で個別に指定できます。CSVのみ必要な場合はgeneratePik=false、generatePdf=falseを指定します。PDF既定項目は入力データ・断面力・pickup断面力・変位・pickup変位です。clientが読み取ったJSONをinputへ文字列で渡し、read_artifactで取得した成果物をclientの指定先へ保存できます。inputPathまたはinputの一方だけを指定してください。",
    inputSchema: {
      ...sourceShape,
      generatePdf: z.boolean().default(true),
      generatePik: z.boolean().default(true).describe("2次元PICKUP断面力のpickup.pikを生成する"),
      generatePickupDisplacementCsv: z.boolean().default(false).describe("変位のPICKUP CSV（pickup-displacement.csv、2D/3D、解析単位の未丸め値）を生成する"),
      generatePickupReactionCsv: z.boolean().default(false).describe("反力のPICKUP CSV（pickup-reaction.csv、2D/3D、解析単位の未丸め値）を生成する"),
      pdfSections: z.array(z.enum(femPythonPdfSections)).min(1).max(femPythonPdfSections.length)
        .refine((sections) => new Set(sections).size === sections.length, "pdfSections must not contain duplicates")
        .default([...femPythonPdfSections]),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ inputPath, input, generatePdf, generatePik, generatePickupDisplacementCsv, generatePickupReactionCsv, pdfSections }) => {
    const sourceError = invalidSourceSelection(inputPath, input);
    if (sourceError) return sourceError;
    if (config.femPythonRunner === null) return unavailable("fempython", "STRUCTURAL_MCP_FEMPYTHON_RUNNER");
    try {
      return await calculate({
        tool: "fempython_calculate", engine: "fempython", runnerPath: config.femPythonRunner,
        command: "run", extensions: [".json"], jobExtension: ".json",
        runnerOptions: ["--generate-pdf", String(generatePdf), "--generate-pik", String(generatePik),
          "--pdf-sections", pdfSections.join(","),
          ...(generatePickupDisplacementCsv ? ["--generate-pickup-displacement-csv", "true"] : []),
          ...(generatePickupReactionCsv ? ["--generate-pickup-reaction-csv", "true"] : [])],
        requiredArtifacts: [
          { relativePath: "result.json", mediaType: "application/json" },
          ...(generatePik ? [{ relativePath: "pickup.pik", mediaType: "text/plain" }] : []),
          ...(generatePdf ? [{ relativePath: "report.pdf", mediaType: "application/pdf" }] : []),
          ...(generatePickupDisplacementCsv ? [{ relativePath: "pickup-displacement.csv", mediaType: "text/csv" }] : []),
          ...(generatePickupReactionCsv ? [{ relativePath: "pickup-reaction.csv", mediaType: "text/csv" }] : []),
        ],
        jsonInput: true, label: "FrameWebforCS 計算・出力",
      }, inputPath, input, config);
    } catch (error) { return requestFailure(error instanceof Error ? error.message : String(error)); }
  });

  server.registerTool("webdan_calculate", {
    title: "Run Capacita RC verification",
    description: ".wdjをCapacitaのRC計算で照査し、PDFまたはMarkdownの成果物を作成します。tool IDは後方互換のためwebdan_calculateを維持しています。",
    inputSchema: { ...sourceShape, outputFormat: z.enum(["pdf", "markdown"]).default("pdf") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ inputPath, input, outputFormat }) => {
    if (config.capacitaRunner === null) return unavailable("capacita", "STRUCTURAL_MCP_WEBDAN_RUNNER");
    try {
      return await calculate({
        tool: "webdan_calculate", engine: "webdan2", runnerPath: config.capacitaRunner,
        command: "run-rc", extensions: [".wdj"], jobExtension: ".wdj",
        runnerOptions: ["--output-format", outputFormat], label: "Capacita (RC)",
      }, inputPath, input, config);
    } catch (error) {
      return requestFailure(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool("webdan_inspect", {
    title: "Inspect Capacita RC input",
    description: ".wdjをCapacitaの文書・RC domain modelで読み、部材、算出点、配筋、材料、断面力、計算条件を正規化して返します。計算は実行しません。",
    inputSchema: sourceShape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ inputPath, input }) => {
    if (config.capacitaRunner === null) return unavailable("capacita", "STRUCTURAL_MCP_WEBDAN_RUNNER");
    const invalid = invalidSourceSelection(inputPath, input);
    if (invalid) return invalid;
    try {
      return await calculate({
        tool: "webdan_inspect", engine: "webdan2", runnerPath: config.capacitaRunner,
        command: "inspect-rc", extensions: [".wdj"], jobExtension: ".wdj", runnerOptions: [], jsonInput: true,
        label: "Capacita RC入力検査",
      }, inputPath, input, config);
    } catch (error) { return requestFailure(error instanceof Error ? error.message : String(error)); }
  });

  server.registerTool("webdan_validate", {
    title: "Validate Capacita RC input",
    description: ".wdjのJSON構造、参照、選択状態、RC domain制約、主要な重複fieldの整合を検証します。計算は実行しません。",
    inputSchema: sourceShape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ inputPath, input }) => {
    if (config.capacitaRunner === null) return unavailable("capacita", "STRUCTURAL_MCP_WEBDAN_RUNNER");
    const invalid = invalidSourceSelection(inputPath, input);
    if (invalid) return invalid;
    try {
      return await calculate({
        tool: "webdan_validate", engine: "webdan2", runnerPath: config.capacitaRunner,
        command: "validate-rc", extensions: [".wdj"], jobExtension: ".wdj", runnerOptions: [], jsonInput: false,
        label: "Capacita RC入力検証",
      }, inputPath, input, config);
    } catch (error) { return requestFailure(error instanceof Error ? error.message : String(error)); }
  });

  server.registerTool("webdan_compose_wdj", {
    title: "Compose Capacita RC input",
    description: "既存.wdjへ明示されたRC意味変更を適用し、同期済みgenerated.wdj、検査結果、変更差分をjob artifactとして返します。不足する設計条件は推測しません。",
    inputSchema: { ...sourceShape, request: webdanComposeRequestSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ inputPath, input, request }) => {
    if (config.capacitaRunner === null) return unavailable("capacita", "STRUCTURAL_MCP_WEBDAN_RUNNER");
    const invalid = invalidSourceSelection(inputPath, input);
    if (invalid) return invalid;
    try {
      return await calculate({
        tool: "webdan_compose_wdj", engine: "webdan2", runnerPath: config.capacitaRunner,
        command: "compose-rc", extensions: [".wdj"], jobExtension: ".json", runnerOptions: [], jsonInput: true,
        label: "Capacita RC入力作成",
      }, inputPath, input, config, (baseDocument) => JSON.stringify({ baseDocument, request }));
    } catch (error) { return requestFailure(error instanceof Error ? error.message : String(error)); }
  });

  server.registerTool("steeldan_calculate", {
    title: "Run experimental SteelDan verification",
    description: ".wsjをSteelDanで照査し、構造化結果と任意のPDFを作成します。数値完全一致は未認定です。",
    inputSchema: { ...sourceShape, generatePdf: z.boolean().default(true) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ inputPath, input, generatePdf }) => {
    if (config.capacitaRunner === null) return unavailable("steeldan", "STRUCTURAL_MCP_WEBDAN_RUNNER");
    if (!config.steelDanEnabled) {
      return textResponse({ ok: false, category: "engine_unavailable", errors: [{ code: "steeldan_disabled", message: "STRUCTURAL_MCP_ENABLE_STEELDAN=trueで明示的に有効化してください。" }] }, "SteelDanは無効です。", true);
    }
    try {
      return await calculate({
        tool: "steeldan_calculate", engine: "steeldan", runnerPath: config.capacitaRunner,
        command: "run-steel", extensions: [".wsj"], jobExtension: ".wsj",
        runnerOptions: ["--generate-pdf", String(generatePdf)], label: "Capacita (SteelDan)",
      }, inputPath, input, config);
    } catch (error) {
      return requestFailure(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool("soilstructure_get_schema", {
    title: "Get SoilStructure document schema",
    description: "SoilStructure document schemaVersion 1のJSON Schema、単位・杭種の意味、operation別必須section、任意の例を返します。不足する設計条件の推測には使用しません。",
    inputSchema: { includeExamples: z.boolean().default(true) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ includeExamples }) => textResponse({
    schemaVersion: 1,
    documentSchema: soilStructureDocumentSchema,
    operationRequirements: {
      pile: { requiredSections: ["pile", "pileGroup", "soilRows"], tool: "soilstructure_calculate" },
      sdc: {
        requiredSections: ["pile", "pileGroup", "soilRows", "sdcExport"],
        supportedPileTypes: [4, 5, 6],
        unsupportedPileTypes: [],
        tool: "soilstructure_export_sdc",
      },
      ground: {
        requiredSections: ["pile", "pileGroup", "soilRows", "groundDisplacement"],
        tool: "soilstructure_ground_displacement",
      },
    },
    validationTool: "soilstructure_validate",
    ...(includeExamples ? { examples: soilStructureExamples } : {}),
  }, "SoilStructure document schemaVersion 1を返しました。"));

  server.registerTool("soilstructure_get_runner_contract", {
    title: "Get SoilStructure standalone runner contract",
    description: "Python等のstandalone scriptからSoilStructure.Headlessを安全に呼ぶためのcommand、artifact、文字コード、envelope、検証・atomic配置の雛形を返します。",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const runner = config.runnerConfigurations.soilStructure;
    return textResponse({
      schemaVersion: 1,
      runner: {
        environmentVariable: runner.environmentVariable,
        path: runner.resolvedPath ?? runner.configuredPath,
        readable: runner.resolvedPath !== null,
        source: runner.source,
      },
      contract: soilStructureRunnerContract,
      pythonTemplate: soilStructurePythonTemplate,
    }, "SoilStructure standalone runner contractを返しました。");
  });

  server.registerTool("soilstructure_validate", {
    title: "Validate SoilStructure input",
    description: "成果物を公開せず、指定operationを実行可能かSoilStructure本体の変換・計算・出力条件で検証します。inputPathまたはinputのどちらか一方だけを指定してください。",
    inputSchema: { ...sourceShape, operation: z.enum(["pile", "sdc", "ground"]).default("pile") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ inputPath, input, operation }) => {
    const sourceError = invalidSourceSelection(inputPath, input);
    if (sourceError) return sourceError;
    if (config.soilStructureRunner === null) return unavailable("soilstructure", "STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER");
    try {
      return await calculate({
        tool: "soilstructure_validate", engine: "soilstructure", runnerPath: config.soilStructureRunner,
        command: "validate", extensions: [".soilstructure.json", ".json"], jobExtension: ".soilstructure.json",
        runnerOptions: ["--operation", operation], jsonInput: true, label: `SoilStructure ${operation}入力検証`,
      }, inputPath, input, config);
    } catch (error) {
      return requestFailure(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool("soilstructure_calculate", {
    title: "Run SoilStructure pile calculation",
    description: "SoilStructure document JSONを計算し、構造化結果と任意のPDF・Excel帳票をjob内に作成します。generateExcel=trueとgeneratePdf=trueで同じ計算済みExcelシートから両方を生成します。Excel生成にはWindowsとMicrosoft Excelが必要です。指定先への配置はclient側で行います。inputPathまたはinputのどちらか一方だけを指定してください。",
    inputSchema: {
      ...sourceShape,
      generatePdf: z.boolean().default(true),
      generateExcel: z.boolean().default(false).describe("Excel帳票report.xlsxを生成する（WindowsとMicrosoft Excelが必要）"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ inputPath, input, generatePdf, generateExcel }) => {
    const sourceError = invalidSourceSelection(inputPath, input);
    if (sourceError) return sourceError;
    if (config.soilStructureRunner === null) return unavailable("soilstructure", "STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER");
    try {
      return await calculate({
        tool: "soilstructure_calculate", engine: "soilstructure", runnerPath: config.soilStructureRunner,
        command: "run", extensions: [".soilstructure.json", ".json"], jobExtension: ".soilstructure.json",
        runnerOptions: (outputDirectory) => [
          "--generate-pdf", String(generatePdf),
          ...(generateExcel ? ["--xlsx-output", resolve(outputDirectory, "report.xlsx")] : []),
        ], jsonInput: true, label: "SoilStructure 杭計算",
      }, inputPath, input, config);
    } catch (error) {
      return requestFailure(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool("soilstructure_export_sdc", {
    title: "Export SoilStructure SNAP SDC files",
    description: "SoilStructure document JSONの杭計算とsdcExport設定から、杭種4/5/6の通常・液状化L1/L2 SNAP連携SDCファイルを作成します。回転杭では押込み側と引抜き側のf/g杭先端ばね・杭先端支持力を出力します。inputPathまたはinputのどちらか一方だけを指定してください。",
    inputSchema: { ...sourceShape },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ inputPath, input }) => {
    const sourceError = invalidSourceSelection(inputPath, input);
    if (sourceError) return sourceError;
    if (config.soilStructureRunner === null) return unavailable("soilstructure", "STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER");
    try {
      return await calculate({
        tool: "soilstructure_export_sdc", engine: "soilstructure", runnerPath: config.soilStructureRunner,
        command: "export-sdc", extensions: [".soilstructure.json", ".json"], jobExtension: ".soilstructure.json",
        runnerOptions: [], jsonInput: true, label: "SoilStructure SNAP連携",
      }, inputPath, input, config);
    } catch (error) {
      return requestFailure(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool("soilstructure_ground_displacement", {
    title: "Run SoilStructure ground displacement calculation",
    description: "SoilStructure document JSONのgroundDisplacement設定からL1/L2地盤応答変位を計算し、構造化結果、任意のPDFとJOTを作成します。inputPathまたはinputのどちらか一方だけを指定してください。",
    inputSchema: {
      ...sourceShape,
      generatePdf: z.boolean().default(true),
      generateJot: z.boolean().default(true),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ inputPath, input, generatePdf, generateJot }) => {
    const sourceError = invalidSourceSelection(inputPath, input);
    if (sourceError) return sourceError;
    if (config.soilStructureRunner === null) return unavailable("soilstructure", "STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER");
    try {
      return await calculate({
        tool: "soilstructure_ground_displacement", engine: "soilstructure", runnerPath: config.soilStructureRunner,
        command: "run-ground-displacement", extensions: [".soilstructure.json", ".json"], jobExtension: ".soilstructure.json",
        runnerOptions: ["--generate-pdf", String(generatePdf), "--generate-jot", String(generateJot)],
        jsonInput: true, label: "SoilStructure 地盤応答変位",
      }, inputPath, input, config);
    } catch (error) {
      return requestFailure(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool("get_job", {
    title: "Get structural calculation job",
    description: "jobIdから計算要約と成果物metadataを取得します。",
    inputSchema: { jobId: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ jobId }) => {
    try {
      const manifest = await loadManifest(jobId, config);
      return textResponse(publicManifest(manifest), `${manifest.engine} job ${jobId}: ${manifest.executionStatus}`);
    } catch (error) {
      return textResponse({ ok: false, category: "input_access", errors: [{ code: "job_not_found", message: error instanceof Error ? error.message : String(error) }] }, "jobを取得できませんでした。", true);
    }
  });

  server.registerTool("read_artifact", {
    title: "Read an artifact as Base64 bytes",
    description: "jobに属する検証済み成果物をbyte範囲で取得します。base64を復号してoffset順に連結し、metadataのbytesとSHA-256を検証してclient側の指定先へ保存してください。PDF・PIKを含むbinaryに対応します。",
    inputSchema: {
      jobId: z.string().min(1),
      artifactId: z.string().min(1),
      offsetBytes: z.number().int().nonnegative().default(0),
      maxBytes: z.number().int().positive().max(config.maxTextReadBytes).default(Math.min(64 * 1024, config.maxTextReadBytes)),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ jobId, artifactId, offsetBytes, maxBytes }) => {
    try {
      const result = await readArtifact(jobId, artifactId, offsetBytes, maxBytes, config);
      return textResponse(result, `${artifactId}を${result.offsetBytes} byteから取得しました。`);
    } catch (error) {
      return textResponse({ ok: false, category: "input_access", errors: [{ code: "artifact_read_failed", message: error instanceof Error ? error.message : String(error) }] }, "成果物を取得できませんでした。", true);
    }
  });

  server.registerTool("read_text_artifact", {
    title: "Read a text artifact",
    description: "jobに属するJSONまたはMarkdown成果物をUTF-8 byte範囲で読みます。",
    inputSchema: {
      jobId: z.string().min(1),
      artifactId: z.string().min(1),
      offsetBytes: z.number().int().nonnegative().default(0),
      maxBytes: z.number().int().positive().max(config.maxTextReadBytes).default(Math.min(64 * 1024, config.maxTextReadBytes)),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ jobId, artifactId, offsetBytes, maxBytes }) => {
    try {
      const result = await readTextArtifact(jobId, artifactId, offsetBytes, maxBytes, config);
      return textResponse(result, `${artifactId}を${result.offsetBytes} byteから読み取りました。`);
    } catch (error) {
      return textResponse({ ok: false, category: "input_access", errors: [{ code: "artifact_read_failed", message: error instanceof Error ? error.message : String(error) }] }, "成果物を読み取れませんでした。", true);
    }
  });

  return server;
}
