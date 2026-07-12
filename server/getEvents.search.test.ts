import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb, getEvents } from "./db";
import { events } from "../drizzle/schema";

// Real-DB integration test for alias-based bilingual search. Skipped without
// DATABASE_URL (CI); run locally against the dev DB. Seeds a few events with
// search aliases + tags, exercises the search, then cleans up.
const hasDb = !!process.env.DATABASE_URL;

const MARKER = "ZZSEARCHTEST"; // unique venue marker so we can scope + clean up
const seededIds: number[] = [];

async function titles(search: string): Promise<string[]> {
  const rows = await getEvents({ search: `${MARKER} ${search}`, limit: 50 });
  return rows.map((r) => r.title);
}

describe.skipIf(!hasDb)("getEvents - alias-based bilingual search (real DB)", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) return;
    const eventDate = new Date("2026-09-01T10:00:00.000Z");
    const seed = [
      {
        title: "2026 CORTIS TOUR - SEOUL",
        venue: `고척스카이돔 ${MARKER}`,
        searchAliases: "코르티스,cortis,코티,서울",
        tags: "K-POP,고척돔,월드투어",
      },
      {
        title: "아이유 콘서트 2026",
        venue: `올림픽공원 ${MARKER}`,
        searchAliases: "IU,아이유,iu concert",
        tags: "발라드,올림픽공원",
      },
      {
        title: "부산 불꽃축제",
        venue: `광안리 ${MARKER}`,
        searchAliases: null,
        tags: "페스티벌",
      },
    ];
    for (const s of seed) {
      const res = (await db.insert(events).values({
        title: s.title,
        category: "concert",
        eventDate,
        venue: s.venue,
        status: "active",
        searchAliases: s.searchAliases,
        tags: s.tags,
      })) as any;
      seededIds.push(res[0].insertId);
    }
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db || seededIds.length === 0) return;
    await db.delete(events).where(inArray(events.id, seededIds));
  });

  it("finds an English-titled event by its Korean alias (코르티스 → CORTIS)", async () => {
    expect(await titles("코르티스")).toEqual(["2026 CORTIS TOUR - SEOUL"]);
  });

  it("matches the lowercase romanization (cortis)", async () => {
    expect(await titles("cortis")).toEqual(["2026 CORTIS TOUR - SEOUL"]);
  });

  it("matches uppercase against the binary-collation title (CORTIS)", async () => {
    expect(await titles("CORTIS")).toEqual(["2026 CORTIS TOUR - SEOUL"]);
  });

  it("supports multi-token AND across columns (코르티스 서울 → alias + title)", async () => {
    expect(await titles("코르티스 서울")).toEqual(["2026 CORTIS TOUR - SEOUL"]);
  });

  it("returns nothing when one token has no match (코르티스 부산)", async () => {
    expect(await titles("코르티스 부산")).toEqual([]);
  });

  it("matches an event with no alias by its plain title (불꽃)", async () => {
    expect(await titles("불꽃")).toEqual(["부산 불꽃축제"]);
  });

  it("matches by tag (고척돔)", async () => {
    expect(await titles("고척돔")).toEqual(["2026 CORTIS TOUR - SEOUL"]);
  });

  it("is case-insensitive for the English alias (IU vs iu)", async () => {
    expect(await titles("iu")).toEqual(["아이유 콘서트 2026"]);
  });
});
