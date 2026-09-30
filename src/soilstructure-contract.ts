const nullableCell = { type: ["string", "null"], maxLength: 256 } as const;

export const soilStructureDocumentSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://local.structural-mcp/schemas/soilstructure-document-v1.json",
  title: "SoilStructure document",
  description: "SoilStructure GUI/headless共通のdocument schemaVersion 1。数値セルはGUI互換のため文字列またはnullです。",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "pileType", "pile", "pileGroup", "soilRows"],
  properties: {
    schemaVersion: { const: 1 },
    pileType: {
      type: "integer",
      enum: [4, 5, 6],
      description: "4=鋼管ソイルセメント杭、5=回転杭、6=場所打ち杭",
    },
    constructionMethod: {
      type: ["string", "null"],
      enum: ["naturalSlurry", "stabilizingFluid", null],
      description: "pileType=6で必須。pileType=4/5ではnullまたは省略。",
    },
    pile: { $ref: "#/$defs/pile" },
    pileGroup: { $ref: "#/$defs/pileGroup" },
    soilRows: {
      type: "array",
      minItems: 1,
      maxItems: 15,
      items: { $ref: "#/$defs/soilRow" },
      description: "末尾の全項目null行は許容されます。途中の空行は実行時検証に従います。",
    },
    sdcExport: { oneOf: [{ $ref: "#/$defs/sdcExport" }, { type: "null" }] },
    groundDisplacement: { oneOf: [{ $ref: "#/$defs/groundDisplacement" }, { type: "null" }] },
    outputFileName: {
      type: ["string", "null"],
      maxLength: 256,
      pattern: "^[^/\\\\]+\\.pdf$",
      description: "GUI保存用のファイル名。Headlessのartifact名は常にreport.pdfです。",
    },
  },
  allOf: [
    {
      if: { properties: { pileType: { const: 6 } }, required: ["pileType"] },
      then: { required: ["constructionMethod"] },
      else: { properties: { constructionMethod: { type: "null" } } },
    },
    {
      if: { properties: { sdcExport: { type: "object" } }, required: ["sdcExport"] },
      then: { properties: { pileType: { enum: [4, 5, 6] } } },
    },
  ],
  $defs: {
    pile: {
      type: "object",
      additionalProperties: false,
      required: [
        "diameterM", "lengthM", "embedmentDepthM", "groundwaterDepthM",
        "unitWeight", "stiffness", "bladeOuterDiameterM", "bladeInnerDiameterM",
      ],
      properties: {
        diameterM: { type: "number", exclusiveMinimum: 0, description: "杭径 (m)" },
        lengthM: { type: "number", exclusiveMinimum: 0, description: "杭長 (m)" },
        embedmentDepthM: { type: "number", minimum: 0, description: "杭頭の根入れ深さ (m)" },
        groundwaterDepthM: { type: "number", description: "地下水位深さ (m、地表から下向き正)" },
        unitWeight: { type: "number", exclusiveMinimum: 0, description: "pileType=6: kN/m3、pileType=4/5: kN/m" },
        stiffness: { type: "number", exclusiveMinimum: 0, description: "pileType=6: 弾性係数 kN/mm2、pileType=4/5: 断面二次モーメント m4" },
        bladeOuterDiameterM: { type: "number", minimum: 0, description: "回転杭の羽根外径 (m)" },
        bladeInnerDiameterM: { type: "number", minimum: 0, description: "回転杭の羽根内径 (m)" },
      },
    },
    groupDirection: {
      type: "object",
      additionalProperties: false,
      required: ["lmM", "lnM", "m", "n"],
      properties: {
        lmM: { type: "number", minimum: 0, description: "m方向杭間隔 (m)" },
        lnM: { type: "number", minimum: 0, description: "n方向杭間隔 (m)" },
        m: { type: "integer", minimum: 1, maximum: 100, description: "m方向杭本数" },
        n: { type: "integer", minimum: 1, maximum: 100, description: "n方向杭本数" },
      },
    },
    pileGroup: {
      type: "object",
      additionalProperties: false,
      required: ["longitudinal", "transverse"],
      properties: {
        longitudinal: { $ref: "#/$defs/groupDirection" },
        transverse: { $ref: "#/$defs/groupDirection" },
      },
    },
    soilRow: {
      type: "object",
      additionalProperties: false,
      required: [
        "thicknessM", "soilKind", "nValue", "wetUnitWeightKnPerM3",
        "submergedUnitWeightKnPerM3", "frictionAngleDegrees", "cohesionKnPerM2",
        "deformationModulusKnPerM2", "deL1", "deL2",
      ],
      properties: {
        thicknessM: { ...nullableCell, description: "層厚 (m)" },
        soilKind: { type: ["string", "null"], enum: ["粘性土", "砂質土", "砂礫", null] },
        nValue: { ...nullableCell, description: "N値" },
        wetUnitWeightKnPerM3: { ...nullableCell, description: "湿潤単位体積重量 (kN/m3)" },
        submergedUnitWeightKnPerM3: { ...nullableCell, description: "水中単位体積重量 (kN/m3)" },
        frictionAngleDegrees: { ...nullableCell, description: "内部摩擦角 (度)。砂質土・砂礫で必須。" },
        cohesionKnPerM2: { ...nullableCell, description: "粘着力 (kN/m2)" },
        deformationModulusKnPerM2: { ...nullableCell, description: "変形係数 (kN/m2)" },
        deL1: { ...nullableCell, description: "液状化L1低減係数 (0～1)" },
        deL2: { ...nullableCell, description: "液状化L2低減係数 (0～1)" },
      },
    },
    sdcColumn: {
      type: "object",
      additionalProperties: false,
      required: ["distanceFromFirstM", "pileCount"],
      properties: {
        distanceFromFirstM: { ...nullableCell, description: "第1列からの距離 (m)" },
        pileCount: { ...nullableCell, description: "当該列の杭本数" },
      },
    },
    sdcExport: {
      type: "object",
      additionalProperties: false,
      required: [
        "equivalentWidthPileCount", "steelPipeDiameterM", "steelPipeThicknessMm",
        "corrosionAllowanceMm", "longitudinalRows", "transverseRows",
      ],
      properties: {
        equivalentWidthPileCount: { type: "integer", minimum: 1, maximum: 10000 },
        steelPipeDiameterM: { type: "number", minimum: 0.01, maximum: 10, description: "鋼管径 (m)" },
        steelPipeThicknessMm: { type: "number", minimum: 0.1, maximum: 5000, description: "鋼管厚 (mm)" },
        corrosionAllowanceMm: { type: "number", minimum: 0, maximum: 100, description: "腐食しろ (mm、鋼管厚未満)" },
        longitudinalRows: { type: "array", maxItems: 12, items: { $ref: "#/$defs/sdcColumn" } },
        transverseRows: { type: "array", maxItems: 12, items: { $ref: "#/$defs/sdcColumn" } },
      },
    },
    groundDisplacementRow: {
      type: "object",
      additionalProperties: false,
      required: ["layerNumber", "thicknessM", "unitWeightKnPerM3", "shearWaveVelocityMPerSecond"],
      properties: {
        layerNumber: { ...nullableCell, description: "応答変位計算上の層番号" },
        thicknessM: { ...nullableCell, description: "分割層厚 (m)" },
        unitWeightKnPerM3: { ...nullableCell, description: "同一層の先頭行で指定する単位体積重量 (kN/m3)" },
        shearWaveVelocityMPerSecond: { ...nullableCell, description: "同一層の先頭行で指定するせん断波速度 (m/s)" },
      },
    },
    groundDisplacement: {
      type: "object",
      additionalProperties: false,
      required: [
        "standardDesignSeismicCoefficient", "regionalCoefficient", "jotEquivalentPeriodSeconds",
        "jotVersion", "includeL1", "includeL2", "l2Spectrum", "rows",
      ],
      properties: {
        standardDesignSeismicCoefficient: { type: "number", minimum: 0, maximum: 10 },
        regionalCoefficient: { type: "number", minimum: 0, maximum: 10 },
        jotEquivalentPeriodSeconds: { type: "number", exclusiveMinimum: 0, maximum: 100 },
        jotVersion: { type: "string", minLength: 1, maxLength: 256 },
        includeL1: { type: "boolean" },
        includeL2: { type: "boolean" },
        l2Spectrum: { type: "integer", enum: [1, 2] },
        rows: { type: "array", maxItems: 58, items: { $ref: "#/$defs/groundDisplacementRow" } },
      },
    },
  },
} as const;

export const soilStructureExamples = {
  pileDocument: {
    schemaVersion: 1,
    pileType: 6,
    constructionMethod: "naturalSlurry",
    pile: {
      diameterM: 1.5,
      lengthM: 6,
      embedmentDepthM: 2,
      groundwaterDepthM: 0,
      unitWeight: 24.5,
      stiffness: 22.4,
      bladeOuterDiameterM: 0,
      bladeInnerDiameterM: 0,
    },
    pileGroup: {
      longitudinal: { lmM: 2.5, lnM: 0, m: 3, n: 1 },
      transverse: { lmM: 0, lnM: 2.5, m: 1, n: 3 },
    },
    soilRows: [{
      thicknessM: "8",
      soilKind: "粘性土",
      nValue: "10",
      wetUnitWeightKnPerM3: "18",
      submergedUnitWeightKnPerM3: "8",
      frictionAngleDegrees: null,
      cohesionKnPerM2: "62.5",
      deformationModulusKnPerM2: "23500",
      deL1: null,
      deL2: null,
    }],
    outputFileName: "report.pdf",
  },
  sdcExport: {
    equivalentWidthPileCount: 3,
    steelPipeDiameterM: 1.5,
    steelPipeThicknessMm: 22,
    corrosionAllowanceMm: 1,
    longitudinalRows: [
      { distanceFromFirstM: "0", pileCount: "1" },
      { distanceFromFirstM: "2.5", pileCount: "3" },
    ],
    transverseRows: [
      { distanceFromFirstM: "0", pileCount: "1" },
    ],
  },
  groundDisplacement: {
    standardDesignSeismicCoefficient: 1,
    regionalCoefficient: 1,
    jotEquivalentPeriodSeconds: 0.56,
    jotVersion: "Ver.5.1.2",
    includeL1: true,
    includeL2: true,
    l2Spectrum: 2,
    rows: [
      { layerNumber: "1", thicknessM: "1.000", unitWeightKnPerM3: "18", shearWaveVelocityMPerSecond: "200" },
    ],
  },
} as const;

export const soilStructureRunnerContract = {
  protocolVersion: 1,
  engine: "soilstructure",
  environmentVariable: "STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER",
  invocation: "引数配列で直接起動し、shellは使用しません。stdoutはJSON envelope 1個、ログはstderrです。",
  commands: {
    validate: {
      arguments: ["validate", "--input", "<file>", "--output-dir", "<empty-dir>", "--operation", "pile|sdc|ground"],
      artifacts: [],
    },
    pile: {
      arguments: ["run", "--input", "<file>", "--output-dir", "<empty-dir>", "--generate-pdf", "true|false"],
      artifacts: ["result.json", "report.pdf (optional)"],
    },
    sdc: {
      arguments: ["export-sdc", "--input", "<file>", "--output-dir", "<empty-dir>"],
      artifacts: ["result.json", "report.sdc", "report_液状化L1.sdc (conditional)", "report_液状化L2.sdc (conditional)"],
      restrictions: [
        "pileTypeは4（鋼管ソイルセメント杭）、5（回転杭）、6（場所打ち杭）に対応します。",
        "pileType 5ではsdcExport.steelPipeDiameterMをpile.diameterMと一致させ、steelPipeThicknessMmとcorrosionAllowanceMmを設計入力として明示します。",
        "pileType 5のSDCには押込み側に加え、引抜き側のf/g杭先端ばね・杭先端支持力を出力します。",
      ],
    },
    ground: {
      arguments: [
        "run-ground-displacement", "--input", "<file>", "--output-dir", "<empty-dir>",
        "--generate-pdf", "true|false", "--generate-jot", "true|false",
      ],
      artifacts: ["result.json", "report.pdf (optional)", "ground-displacementL1.JOT (conditional)", "ground-displacementL2.JOT (conditional)"],
    },
  },
  artifactEncoding: {
    json: "UTF-8 without BOM",
    pdf: "binary application/pdf",
    sdc: "CP932 with CRLF",
    jot: "CP932 with CRLF",
  },
  envelopeRules: {
    exitCode: "0 iff ok=true。失敗時もprotocolVersion 1 envelopeをstdoutへ返します。",
    requiredFields: [
      "protocolVersion", "engine", "engineVersion", "readiness", "ok", "executionStatus",
      "engineeringStatus", "summary", "messages", "artifacts", "errors",
    ],
    artifactVerification: "relativePathがoutput directory内であること、bytes、sha256を検証してから配置します。",
  },
} as const;

export const soilStructurePythonTemplate = String.raw`from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path


def run_soilstructure(input_path: Path, command: list[str], destinations: dict[str, Path]) -> None:
    runner = Path(os.environ["STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER"]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="soilstructure-") as temporary:
        output_dir = Path(temporary)
        completed = subprocess.run(
            [str(runner), *command, "--input", str(input_path.resolve(strict=True)), "--output-dir", str(output_dir)],
            check=False, capture_output=True, text=True, encoding="utf-8",
        )
        envelope = json.loads(completed.stdout)
        if completed.returncode != 0 or not envelope.get("ok"):
            raise RuntimeError(json.dumps(envelope.get("errors", []), ensure_ascii=False))
        for artifact in envelope["artifacts"]:
            target = destinations.get(artifact["relativePath"])
            if target is None:
                continue
            source = output_dir / artifact["relativePath"]
            payload = source.read_bytes()
            if len(payload) != artifact["bytes"] or hashlib.sha256(payload).hexdigest() != artifact["sha256"]:
                raise RuntimeError(f"artifact verification failed: {source.name}")
            target.parent.mkdir(parents=True, exist_ok=True)
            staging = target.with_name(f".{target.name}.tmp")
            staging.write_bytes(payload)
            os.replace(staging, target)
`;
