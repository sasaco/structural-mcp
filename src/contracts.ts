import { z } from "zod";

export const runnerMessageSchema = z.object({
  level: z.string(),
  code: z.string(),
  text: z.string(),
  path: z.string().nullable().optional(),
});

export const runnerArtifactSchema = z.object({
  kind: z.string(),
  mediaType: z.string(),
  relativePath: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const runnerEnvelopeSchema = z.object({
  protocolVersion: z.literal(1),
  engine: z.string(),
  engineVersion: z.string().min(1),
  readiness: z.string(),
  ok: z.boolean(),
  executionStatus: z.string(),
  engineeringStatus: z.string(),
  summary: z.unknown().nullable(),
  messages: z.array(runnerMessageSchema),
  artifacts: z.array(runnerArtifactSchema),
  errors: z.array(z.object({
    category: z.string().optional(),
    code: z.string(),
    message: z.string(),
  }).passthrough()),
});

export type RunnerEnvelope = z.infer<typeof runnerEnvelopeSchema>;

export interface ArtifactRecord {
  artifactId: string;
  name: string;
  mediaType: string;
  relativePath: string;
  bytes: number;
  sha256: string;
}

export interface JobManifest {
  schemaVersion: 1;
  jobId: string;
  tool:
    | "fempython_calculate"
    | "webdan_calculate"
    | "webdan_inspect"
    | "webdan_validate"
    | "webdan_compose_wdj"
    | "steeldan_calculate"
    | "soilstructure_validate"
    | "soilstructure_calculate"
    | "soilstructure_export_sdc"
    | "soilstructure_ground_displacement";
  engine: "fempython" | "webdan2" | "steeldan" | "soilstructure";
  engineVersion: string;
  readiness: string;
  createdAt: string;
  completedAt: string;
  ok: boolean;
  executionStatus: string;
  engineeringStatus: string;
  summary: unknown;
  messages: z.infer<typeof runnerMessageSchema>[];
  artifacts: ArtifactRecord[];
  errors: RunnerEnvelope["errors"];
}
