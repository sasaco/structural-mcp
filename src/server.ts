import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { JobManifest } from "./contracts.js";
import {
  createJob,
  loadManifest,
  readTextArtifact,
  resolveInputPath,
  saveManifest,
  verifyArtifacts,
} from "./jobs.js";
import { runEngine } from "./runner.js";

const sourceShape = {
  inputPath: z.string().min(1).optional().describe("Allowed root内にある入力ファイルの絶対パス"),
  input: z.string().min(1).optional().describe("入力ファイルの内容をinlineで指定"),
};

interface CalculationSpec {
  tool: JobManifest["tool"];
  engine: JobManifest["engine"];
  runnerPath: string;
  command: "run-rc" | "run-steel" | "run" | "export-sdc" | "run-ground-displacement";
  extensions: readonly string[];
  jobExtension: ".wdj" | ".wsj" | ".soilstructure.json";
  runnerOptions: readonly string[];
  jsonInput?: boolean;
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
): Promise<ReturnType<typeof textResponse>> {
  const contents = await inputContents(inputPath, input, spec.extensions, spec.jsonInput ?? false, config);
  const startedAt = new Date().toISOString();
  const job = await createJob(spec.tool, contents, spec.jobExtension, config);
  const envelope = await runEngine(
    spec.runnerPath,
    spec.command,
    spec.engine,
    job.inputPath,
    job.outputDirectory,
    spec.runnerOptions,
    config,
  );
  const artifacts = await verifyArtifacts(job.outputDirectory, envelope, config);
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
    ? `${spec.label}の計算が完了しました。jobId: ${job.jobId}`
    : `${spec.label}の計算に失敗しました。jobId: ${job.jobId}`;
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
  const capacitaEnabled = config.capacitaRunner !== null;
  const soilStructureEnabled = config.soilStructureRunner !== null;
  const steelDanEnabled = capacitaEnabled && config.steelDanEnabled;
  const server = new McpServer(
    { name: "structural-mcp", version: "0.1.0" },
    {
      instructions: "FEMPython、Capacita、SoilStructureを公開する構造計算MCPです。計算前にget_capabilitiesでrunnerの利用可否を確認してください。SoilStructureは杭計算、SDC出力、地盤応答変位を別toolで扱います。.envの作成やrunner pathの質問にはget_environment_templateを使用してください。executionStatusとengineeringStatusは別々に確認し、成果物はjob単位で扱ってください。",
    },
  );

  server.registerTool("get_environment_template", {
    title: "Get structural-mcp .env template",
    description: "AIが対象プロジェクトの.envを作成するときに使うrunner設定名、推奨絶対パス、読取可否を返します。既存.envや秘密情報は読み取りません。",
    inputSchema: { engine: z.enum(["all", "capacita", "soilstructure"]).default("all") },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ engine }) => {
    const entries = [
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
      fempython: { enabled: false, readiness: "unavailable", note: "MCP adapter is not implemented" },
      capacita: { enabled: capacitaEnabled, readiness: capacitaEnabled ? "production" : "unavailable", compatibilityTool: "webdan_calculate", outputFormats: ["pdf", "markdown"] },
      webdan2: { enabled: capacitaEnabled, readiness: capacitaEnabled ? "production" : "unavailable", aliasFor: "capacita", deprecated: true, outputFormats: ["pdf", "markdown"] },
      steeldan: { enabled: steelDanEnabled, readiness: "experimental", outputFormats: ["json", "pdf"] },
      soilstructure: {
        enabled: soilStructureEnabled,
        readiness: soilStructureEnabled ? "production" : "unavailable",
        inputFormats: [".soilstructure.json", ".json", "inline-json"],
        outputFormats: ["json", "pdf", "sdc", "jot"],
        tools: ["soilstructure_calculate", "soilstructure_export_sdc", "soilstructure_ground_displacement"],
      },
    },
    configurationTool: "get_environment_template",
    limits: { timeoutMs: config.timeoutMs, maxInputBytes: config.maxInputBytes, maxArtifactBytes: config.maxArtifactBytes },
  }, `Capacitaは${capacitaEnabled ? "利用可能" : "利用不可"}、SoilStructureは${soilStructureEnabled ? "利用可能" : "利用不可"}です。`));

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

  server.registerTool("soilstructure_calculate", {
    title: "Run SoilStructure pile calculation",
    description: "SoilStructure document JSONを計算し、構造化結果と任意のPDF帳票を作成します。inputPathまたはinputのどちらか一方だけを指定してください。",
    inputSchema: { ...sourceShape, generatePdf: z.boolean().default(true) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ inputPath, input, generatePdf }) => {
    const sourceError = invalidSourceSelection(inputPath, input);
    if (sourceError) return sourceError;
    if (config.soilStructureRunner === null) return unavailable("soilstructure", "STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER");
    try {
      return await calculate({
        tool: "soilstructure_calculate", engine: "soilstructure", runnerPath: config.soilStructureRunner,
        command: "run", extensions: [".soilstructure.json", ".json"], jobExtension: ".soilstructure.json",
        runnerOptions: ["--generate-pdf", String(generatePdf)], jsonInput: true, label: "SoilStructure 杭計算",
      }, inputPath, input, config);
    } catch (error) {
      return requestFailure(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool("soilstructure_export_sdc", {
    title: "Export SoilStructure SNAP SDC files",
    description: "SoilStructure document JSONの杭計算とsdcExport設定から、通常・液状化L1/L2のSNAP連携SDCファイルを作成します。inputPathまたはinputのどちらか一方だけを指定してください。",
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
