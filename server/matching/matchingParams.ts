import { z } from "zod";
import type { PipelineParams } from "./pipeline";

// Single source of truth for the matching pipeline's tunable parameters and
// their defaults. Both the admin manual flow (routers.ts) and the automatic
// D-7 freeze scheduler resolve against this same schema, so "run it the way
// the admin preview does" means literally the same numbers.
export const pipelineParamsSchema = z.object({
  bucketSizeMinutes: z.number().min(5).default(30),
  epsMeters: z.number().min(50).default(800),
  minPts: z.number().min(1).default(10),
  maxSnapDistanceMeters: z.number().min(0).default(300),
  maxCapacitySeats: z.number().min(1).default(45),
  minCapacitySeats: z.number().min(1).default(15),
  avgSpeedKmh: z.number().min(1).default(30),
  stopDwellMinutes: z.number().min(0).default(3),
  mergeMaxDetourMinutes: z.number().min(0).default(15),
  mergeMaxDetourKm: z.number().min(0).default(10),
});

export const pipelineParamsInput = pipelineParamsSchema.partial().optional();

export type PipelineParamsInput = z.infer<typeof pipelineParamsInput>;

export function resolvePipelineParams(input?: PipelineParamsInput): PipelineParams {
  return pipelineParamsSchema.parse(input ?? {});
}

// The parameter set the D-7 auto-freeze scheduler runs with: the plain
// defaults, identical to an admin preview/commit with no overrides.
export const DEFAULT_PIPELINE_PARAMS: PipelineParams = pipelineParamsSchema.parse({});
