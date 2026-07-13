import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection, type Connection } from "mysql2/promise";
import * as db from "../db";

// 제안자 보상 잠금(claimBungaetingProposalReward)이 실 DB의 조건부 UPDATE로
// 정확히 한 번만 성공하는지 검증한다 (재실행/동시 호출 이중지급 방지, spec §3-5).
const hasDb = !!process.env.DATABASE_URL;
const EVENT = 999002;

async function conn(): Promise<Connection> {
  const url = new URL(process.env.DATABASE_URL as string);
  return createConnection({
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\/+/, ""),
    ssl: url.searchParams.get("ssl") === "true" ? { rejectUnauthorized: true } : undefined,
  });
}
async function cleanup() {
  const c = await conn();
  try { await c.query("DELETE FROM bungaeting_trip_proposals WHERE eventId=?", [EVENT]); }
  finally { await c.end(); }
}

describe.skipIf(!hasDb)("제안자 보상 잠금 (real DB)", () => {
  let proposalId: number;

  beforeEach(async () => {
    await cleanup();
    proposalId = await db.createBungaetingProposal({
      eventId: EVENT, proposerId: 1, proposedDate: new Date("2026-10-01T10:00:00Z"), status: "open",
    });
  });
  afterEach(cleanup);

  it("claim을 여러 번/동시에 호출해도 딱 한 번만 true", async () => {
    const results = await Promise.all([
      db.claimBungaetingProposalReward(proposalId),
      db.claimBungaetingProposalReward(proposalId),
      db.claimBungaetingProposalReward(proposalId),
    ]);
    expect(results.filter((r) => r === true)).toHaveLength(1);

    // 이후 재실행도 false (이미 지급 잠금됨).
    expect(await db.claimBungaetingProposalReward(proposalId)).toBe(false);

    // rewardGrantedAt이 실제로 세팅됨.
    const c = await conn();
    try {
      const [rows] = await c.query("SELECT rewardGrantedAt FROM bungaeting_trip_proposals WHERE id=?", [proposalId]);
      expect((rows as any[])[0].rewardGrantedAt).not.toBeNull();
    } finally { await c.end(); }
  });

  it("convertBungaetingProposalIfOpen도 open일 때 한 번만 true", async () => {
    const first = await db.convertBungaetingProposalIfOpen(proposalId, 12345);
    const second = await db.convertBungaetingProposalIfOpen(proposalId, 12345);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});
