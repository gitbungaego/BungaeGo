import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";

const ONE_MINUTE_MS = 60 * 1000;

function sendRateLimited(_req: Request, res: Response) {
  res.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." });
}

// Login/OAuth routes (/api/oauth/*, /app-auth) - tight limit to slow down
// brute-force/credential-stuffing attempts against the login flow.
export const authRateLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: sendRateLimited,
});

// Write-mutation tRPC procedures only (reservation/event/ride-request
// creation). A real user hits one of these a handful of times per minute at
// most, so 20/min per IP leaves comfortable headroom while still blocking
// scripted abuse. Mounted at /api/trpc, so req.path has that prefix stripped
// (e.g. "/reservations.create" or, if ever batched, "/a,reservations.create").
const WRITE_MUTATION_PROCEDURES = ["reservations.create", "events.create", "rideRequests.create"];

export function isWriteMutationRequest(path: string): boolean {
  return WRITE_MUTATION_PROCEDURES.some((procedure) => path.includes(procedure));
}

export const writeMutationRateLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: sendRateLimited,
  skip: (req) => !isWriteMutationRequest(req.path),
});

// Static asset / dev-tooling requests never count toward the global budget,
// in dev or prod: Vite's unbundled dev serving alone fires 100+ requests
// (HMR client, @fs passthroughs, per-module source, node_modules dep chunks)
// on a single page load, which isn't API traffic and shouldn't compete with
// it for the same 100/min budget. /api/* is deliberately never matched here,
// so it stays rate-limited identically in both environments.
const DEV_ASSET_PATH_PREFIXES = ["/@vite", "/@fs", "/src", "/node_modules"];
const DEV_ASSET_EXTENSIONS = [".js", ".ts", ".tsx", ".css"];

export function isStaticAssetRequest(path: string): boolean {
  if (DEV_ASSET_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return DEV_ASSET_EXTENSIONS.some((ext) => path.endsWith(ext));
}

// Global fallback applied to every request.
export const globalRateLimiter = rateLimit({
  windowMs: ONE_MINUTE_MS,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: sendRateLimited,
  skip: (req) => isStaticAssetRequest(req.path),
});
