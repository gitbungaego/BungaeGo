/**
 * 랠리 포인트 후보 시드 스크립트
 *
 * 실행 방법 (DATABASE_URL 설정된 상태):
 *   pnpm tsx scripts/seedRallyPoints.ts
 *
 * - (name, region) 유니크 인덱스 기준 upsert이므로 몇 번을 다시 돌려도 안전합니다
 *   (좌표/비고를 고쳐서 재실행하면 기존 행이 갱신됩니다).
 * - lat/lng가 없는 항목은 지오코딩하지 않고 건너뛰며, 스킵된 항목 목록을 끝에 출력합니다.
 *   좌표를 채운 뒤 다시 실행하면 그 항목만 새로 들어갑니다.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
import { buildMysqlPoolConfig } from "../server/db";
import { rallyPointCandidates, type InsertRallyPointCandidate } from "../drizzle/schema";

interface SeedRallyPoint {
  name: string;
  region: string;
  lat?: number;
  lng?: number;
  busAccessible: boolean;
  notes?: string;
}

const SEED_POINTS: SeedRallyPoint[] = [
  { name: "신복환승센터 전세버스 승차장", region: "울산 남구", lat: 35.5508089, lng: 129.2631874, busAccessible: true, notes: "전세버스 전용 승차장" },
  { name: "울산시외버스터미널 건너 동성웰딩 앞", region: "울산 남구", lat: 35.5362792, lng: 129.3411249, busAccessible: true, notes: "정차 확인 필요" },
  { name: "울산행복신협 삼산점", region: "울산 남구", lat: 35.5399633, lng: 129.3427632, busAccessible: true, notes: "정차 확인 필요" },
  { name: "서면역 12번 출구 앞", region: "부산진구", lat: 35.1588100, lng: 129.0602302, busAccessible: true, notes: "정차 확인 필요" },
  { name: "동래역 3번 출구 150m 앞", region: "부산 동래구", lat: 35.2069454, lng: 129.0782467, busAccessible: true, notes: "정차 확인 필요" },
  { name: "사상역 2번출구 건너", region: "부산 사상구", lat: 35.1623, lng: 128.9846, busAccessible: true, notes: "정차 확인 필요" },
  { name: "봉황역 2번 출구 앞", region: "김해", lat: 35.2274, lng: 128.8744, busAccessible: true, notes: "정차 확인 필요" },
  { name: "김해 동부소방서", region: "김해", lat: 35.2268, lng: 128.8922, busAccessible: true, notes: "정차 확인 필요" },
  { name: "양산역", region: "양산", lat: 35.3387, lng: 129.0264, busAccessible: true, notes: "정차 확인 필요" },
  { name: "창원종합버스터미널", region: "창원", lat: 35.2359, lng: 128.6366, busAccessible: true, notes: "터미널" },
  { name: "마산시외버스터미널", region: "창원", lat: 35.2215, lng: 128.5812, busAccessible: true, notes: "터미널" },
  { name: "창원시청 정문 버스정류장 앞", region: "창원", lat: 35.2273, lng: 128.6811, busAccessible: true, notes: "정차 확인 필요" },
  { name: "창원역 시외고속버스정류소", region: "창원", lat: 35.2599, lng: 128.5997, busAccessible: true, notes: "정류소" },
  { name: "마산역 투썸플레이스 앞", region: "창원", lat: 35.2211, lng: 128.5746, busAccessible: true, notes: "정차 확인 필요" },
  { name: "진주시외버스터미널", region: "진주", lat: 35.1928, lng: 128.0898, busAccessible: true, notes: "터미널" },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const db = drizzle(createPool(buildMysqlPoolConfig(databaseUrl)));

  const skipped: string[] = [];
  let upserted = 0;

  for (const point of SEED_POINTS) {
    if (point.lat === undefined || point.lng === undefined) {
      skipped.push(`${point.name} (${point.region})`);
      continue;
    }

    const values: InsertRallyPointCandidate = {
      name: point.name,
      region: point.region,
      lat: String(point.lat),
      lng: String(point.lng),
      busAccessible: point.busAccessible,
      notes: point.notes,
      isActive: true,
    };

    await db
      .insert(rallyPointCandidates)
      .values(values)
      .onDuplicateKeyUpdate({
        set: {
          lat: values.lat,
          lng: values.lng,
          busAccessible: values.busAccessible,
          notes: values.notes,
        },
      });

    console.log(`[seedRallyPoints] upsert: ${point.name} (${point.region})`);
    upserted++;
  }

  console.log(`\n[seedRallyPoints] 완료 — ${upserted}건 upsert, ${skipped.length}건 스킵`);
  if (skipped.length > 0) {
    console.log("[seedRallyPoints] 좌표 없어서 스킵된 항목 (좌표 보충 후 재실행하세요):");
    for (const name of skipped) console.log(`  - ${name}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
