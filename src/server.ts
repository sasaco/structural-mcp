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
  inputPath: z.string().min(1).optional().describe("Allowed-root内の.wdjまたは.wsjファイル絶対path"),
  input: z.string().min(1).optional().describe("保存ファイルの内容をinlineで指定"),
};

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
  extension: ".wdj" | ".wsj",
  config: AppConfig,
): Promise<string> {
  if ((inputPath === undefined) === (input === undefined)) throw new Error("inputPathまたはinputのどちらか一方を指定してください。");
  if (input !== undefined) {
    if (Buffer.byteLength(input, "utf8") > config.maxInputBytes) throw new Error("inputがsize上限を超えています。");
    return input;
  }
  const resolved = await resolveInputPath(inputPath!, config);
  if (!resolved.toLowerCase().endsWith(extension)) throw new Error(`入力fileの拡張子は${extension}である必要があります。`);
  return readFile(resolved, "utf8");
}

async function calculate(
  tool: JobManifest["tool"],
  inputPath: string | undefined,
  input: string | undefined,
  optionValue: string,
  config: AppConfig,
): Promise<ReturnType<typeof textResponse>> {
  const isRc = tool === "webdan_calculate";
  const contents = await inputContents(inputPath, input, isRc ? ".wdj" : ".wsj", config);
  const startedAt = new Date().toISOString();
  const job = await createJob(tool, contents, isRc ? ".wdj" : ".wsj", config);
  const envelope = await runEngine(
    isRc ? "run-rc" : "run-steel",
    job.inputPath,
    job.outputDirectory,
    isRc ? "--output-format" : "--generate-pdf",
    optionValue,
    config,
  );
  const artifacts = await verifyArtifacts(job.outputDirectory, envelope, config);
  const manifest: JobManifest = {
    schemaVersion: 1,
    jobId: job.jobId,
    tool,
    engine: isRc ? "webdan2" : "steeldan",
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
  const label = isRc ? "WebDan2" : "SteelDan";
  const summary = envelope.ok
    ? `${label}の計算が完了しました。jobId: ${job.jobId}`
    : `${label}の計算は失敗しました。jobId: ${job.jobId}`;
  return textResponse(publicManifest(manifest), summary, !envelope.ok);
}

export function createServer(config: AppConfig): McpServer {
  const server = new McpServer(
    { name: "structural-mcp", version: "0.1.0" },
    {
      instructions: "WebDan2とSteelDanの構造照査を実行します。計算前にget_capabilitiesでreadinessを確認してください。SteelDanはexperimentalです。executionStatus=successは計算処理の完了だけを表し、engineeringStatus=not_okを許容します。工学判定と成果物は必ず別々に確認してください。",
    },
  );

  server.registerTool("get_capabilities", {
    title: "Structural engine capabilities",
    description: "WebDan2とSteelDan runnerの利用可否、readiness、制限を返します。",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => textResponse({
    protocolVersion: 1,
    engines: {
      webdan2: { enabled: true, readiness: "production", outputFormats: ["pdf", "markdown"] },
      steeldan: { enabled: config.steelDanEnabled, readiness: "experimental", outputFormats: ["json", "pdf"] },
    },
    limits: { timeoutMs: config.timeoutMs, maxInputBytes: config.maxInputBytes, maxArtifactBytes: config.maxArtifactBytes },
  }, `WebDan2は利用可能です。SteelDanは${config.steelDanEnabled ? "有効" : "無効"}（experimental）です。`));

  server.registerTool("webdan_calculate", {
    title: "Run WebDan2 RC verification",
    description: ".wdjをWebDan2で照査し、PDFまたはMarkdownの成果物を作成します。",
    inputSchema: { ...sourceShape, outputFormat: z.enum(["pdf", "markdown"]).default("pdf") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ inputPath, input, outputFormat }) => {
    try {
      return await calculate("webdan_calculate", inputPath, input, outputFormat, config);
    } catch (error) {
      return textResponse({ ok: false, category: "calculation", errors: [{ code: "request_failed", message: error instanceof Error ? error.message : String(error) }] }, "WebDan2の実行に失敗しました。", true);
    }
  });

  server.registerTool("steeldan_calculate", {
    title: "Run experimental SteelDan verification",
    description: ".wsjをSteelDanで照査し、構造化結果と任意のPDFを作成します。数値完全一致は未認定です。",
    inputSchema: { ...sourceShape, generatePdf: z.boolean().default(true) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ inputPath, input, generatePdf }) => {
    if (!config.steelDanEnabled) {
      return textResponse({ ok: false, category: "engine_unavailable", errors: [{ code: "steeldan_disabled", message: "STRUCTURAL_MCP_ENABLE_STEELDAN=trueで明示的に有効化してください。" }] }, "SteelDanは無効です。", true);
    }
    try {
      return await calculate("steeldan_calculate", inputPath, input, String(generatePdf), config);
    } catch (error) {
      return textResponse({ ok: false, category: "calculation", errors: [{ code: "request_failed", message: error instanceof Error ? error.message : String(error) }] }, "SteelDanの実行に失敗しました。", true);
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
