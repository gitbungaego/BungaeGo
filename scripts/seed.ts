/**
 * BungaeGo 초기 시드 스크립트 (콜드스타트 해소용)
 *
 * 카카오 T 셔틀 / 핸디버스 / 버스타다에서 2026-07-03 기준 실제 운행·모집 중인
 * 공연/행사 셔틀 정보를 조사하여 작성한 초기 노선 데이터입니다.
 *
 * 실행 방법 (운영 환경, DATABASE_URL 설정된 상태):
 *   pnpm tsx scripts/seed.ts
 *
 * - 이미 같은 제목의 이벤트가 있으면 건너뛰므로 중복 실행해도 안전합니다 (idempotent).
 * - 가격은 왕복 기준(원), 경쟁사(핸디버스 23,000~35,000 / 버스타다 20,000~) 대비
 *   초기 프로모션 가격으로 소폭 낮게 책정했습니다.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { createPool } from "mysql2/promise";
import { buildMysqlPoolConfig } from "../server/db";
import {
  boardingPoints,
  events,
  trips,
  type InsertBoardingPoint,
  type InsertEvent,
  type InsertTrip,
} from "../drizzle/schema";

// ─── 시드 데이터 타입 ─────────────────────────────────────────────────────────
interface SeedBoardingPoint {
  name: string;
  address?: string;
  lat?: string;
  lng?: string;
  /** 출발 시각 기준 상대 분(음수 = 출발 전 픽업 순서용 절대 시각 계산) */
  pickupOffsetMin: number;
}

interface SeedTrip {
  mode: "bus" | "van";
  price: number; // 왕복 기준(원)
  departureAt: Date;
  returnAt?: Date;
  isRoundTrip: boolean;
  minCount?: number;
  maxCount?: number;
  notes?: string;
  boardingPoints: SeedBoardingPoint[];
}

interface SeedEvent {
  title: string;
  category: "concert" | "sports" | "festival" | "rally" | "exhibition" | "other";
  eventDate: Date;
  venue: string;
  address?: string;
  lat?: string;
  lng?: string;
  description?: string;
  organizerName?: string;
  trips: SeedTrip[];
}

// KST 날짜 생성 헬퍼 (서버 TZ와 무관하게 한국 시각 고정)
const kst = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h - 9, mi));

// ─── 주요 탑승 거점 (카카오 T 셔틀/핸디버스에서 공통 확인된 실제 거점) ─────────
const STOP = {
  seoulStation: { name: "서울역 (1번 출구 공항철도 방면)", address: "서울 용산구 한강대로 405", lat: "37.5546788", lng: "126.9706069" },
  hapjeong: { name: "합정역 (8번 출구 앞)", address: "서울 마포구 양화로 지하 55", lat: "37.5496265", lng: "126.9139242" },
  gangnam: { name: "강남역 (5번 출구 시티투어버스 정류장)", address: "서울 강남구 강남대로 396", lat: "37.4979502", lng: "127.0276368" },
  jamsil: { name: "잠실역 (4번 출구 앞)", address: "서울 송파구 올림픽로 지하 265", lat: "37.5132612", lng: "127.1001336" },
  sadang: { name: "사당역 (1번 출구 앞)", address: "서울 동작구 동작대로 3", lat: "37.4765574", lng: "126.9816627" },
  sindorim: { name: "신도림역 (1번 출구 앞)", address: "서울 구로구 새말로 97", lat: "37.5088803", lng: "126.8912295" },
  nowon: { name: "노원역 (3번 출구 앞)", address: "서울 노원구 상계로 69", lat: "37.6552063", lng: "127.0615395" },
  suwon: { name: "수원역 (4번 출구 앞)", address: "경기 수원시 팔달구 덕영대로 924", lat: "37.2659392", lng: "127.0000924" },
  dongtan: { name: "동탄역 (2번 출구 버스정류장, 서측 정류소)", address: "경기 화성시 동탄역로 151", lat: "37.2007565", lng: "127.0965322" },
  migeum: { name: "미금역 (4번 출구 앞)", address: "경기 성남시 분당구 성남대로 165", lat: "37.3499103", lng: "127.1093556" },
  baekseok: { name: "백석역 (2번 출구 60m 앞)", address: "경기 고양시 일산동구 중앙로 1261", lat: "37.6430744", lng: "126.7877771" },
  anyang: { name: "안양역 (일번가몰 11번 출구 앞)", address: "경기 안양시 만안구 만안로 232", lat: "37.4015367", lng: "126.9227093" },
  bupyeong: { name: "부평역 (지하상가 11번 출구 앞)", address: "인천 부평구 광장로 16", lat: "37.4890964", lng: "126.7241102" },
  daejeon: { name: "대전역 (서광장 관광버스 승하차장)", address: "대전 동구 중앙로 215", lat: "36.3315282", lng: "137.4346581" },
} as const;

// ─── 시드 이벤트/노선 정의 ────────────────────────────────────────────────────
const SEED_EVENTS: SeedEvent[] = [
  {
    title: "Stray Kids World Tour in SEOUL",
    category: "concert",
    eventDate: kst(2026, 7, 25, 18, 0),
    venue: "KSPO DOME (올림픽공원 체조경기장)",
    address: "서울 송파구 올림픽로 424",
    lat: "37.5195347",
    lng: "127.1277856",
    description:
      "Stray Kids 월드투어 서울 공연 (2026.07.25 ~ 08.02). 공연 시작 2시간 30분 전 행사장 도착, 종료 후 복귀 출발.",
    organizerName: "번개GO 운영팀",
    trips: [
      {
        mode: "bus",
        price: 22000,
        departureAt: kst(2026, 7, 25, 13, 0),
        returnAt: kst(2026, 7, 25, 22, 30),
        isRoundTrip: true,
        minCount: 15,
        maxCount: 45,
        notes: "수도권 남부 노선 (동탄 → 미금 → 잠실/KSPO DOME). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.dongtan, pickupOffsetMin: 0 },
          { ...STOP.migeum, pickupOffsetMin: 40 },
        ],
      },
      {
        mode: "bus",
        price: 22000,
        departureAt: kst(2026, 7, 25, 13, 30),
        returnAt: kst(2026, 7, 25, 22, 30),
        isRoundTrip: true,
        minCount: 15,
        maxCount: 45,
        notes: "인천/부천 노선 (부평 → 신도림 → KSPO DOME). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.bupyeong, pickupOffsetMin: 0 },
          { ...STOP.sindorim, pickupOffsetMin: 30 },
        ],
      },
    ],
  },
  {
    title: "빅뱅 2026 월드투어 - BIGSHOW: REBORN IN GOYANG",
    category: "concert",
    eventDate: kst(2026, 8, 21, 19, 0),
    venue: "고양종합운동장",
    address: "경기 고양시 일산서구 중앙로 1601",
    lat: "37.6789012",
    lng: "126.7452278",
    description:
      "빅뱅 2026 월드투어 고양 공연 (2026.08.21 ~ 08.23). 경쟁사 기준가 23,000원 대비 초기 프로모션 적용.",
    organizerName: "번개GO 운영팀",
    trips: [
      {
        mode: "bus",
        price: 21000,
        departureAt: kst(2026, 8, 21, 15, 0),
        returnAt: kst(2026, 8, 21, 23, 0),
        isRoundTrip: true,
        minCount: 15,
        maxCount: 45,
        notes: "서울 강남권 노선 (강남 → 사당 → 고양종합운동장). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.gangnam, pickupOffsetMin: 0 },
          { ...STOP.sadang, pickupOffsetMin: 25 },
        ],
      },
      {
        mode: "bus",
        price: 24000,
        departureAt: kst(2026, 8, 21, 14, 0),
        returnAt: kst(2026, 8, 21, 23, 0),
        isRoundTrip: true,
        minCount: 15,
        maxCount: 45,
        notes: "경기 남부 노선 (동탄 → 수원 → 고양종합운동장). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.dongtan, pickupOffsetMin: 0 },
          { ...STOP.suwon, pickupOffsetMin: 30 },
        ],
      },
    ],
  },
  {
    title: "현대카드 슈퍼콘서트 28 위켄드(The Weeknd)",
    category: "concert",
    eventDate: kst(2026, 9, 12, 19, 0),
    venue: "고양종합운동장",
    address: "경기 고양시 일산서구 중앙로 1601",
    lat: "37.6789012",
    lng: "126.7452278",
    description: "The Weeknd 첫 내한 단독 콘서트. 핸디버스 기준가 23,000원~ 참고.",
    organizerName: "번개GO 운영팀",
    trips: [
      {
        mode: "bus",
        price: 21000,
        departureAt: kst(2026, 9, 12, 15, 0),
        returnAt: kst(2026, 9, 12, 23, 0),
        isRoundTrip: true,
        minCount: 15,
        maxCount: 45,
        notes: "서울 도심 노선 (서울역 → 합정 → 고양종합운동장). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.seoulStation, pickupOffsetMin: 0 },
          { ...STOP.hapjeong, pickupOffsetMin: 20 },
        ],
      },
    ],
  },
  {
    title: "2026 CORTIS TOUR 'PUT YOUR PHONE DOWN' - INCHEON",
    category: "concert",
    eventDate: kst(2026, 7, 18, 18, 0),
    venue: "인스파이어 아레나",
    address: "인천 중구 공항문화로 127",
    lat: "37.4405756",
    lng: "126.4207357",
    description:
      "코르티스 월드투어 인천 공연 (2026.07.18 ~ 07.19). 영종도 특성상 셔틀 수요 높음. 버스타다 20,000원~ / 핸디버스 23,000원~ 참고.",
    organizerName: "번개GO 운영팀",
    trips: [
      {
        mode: "bus",
        price: 19000,
        departureAt: kst(2026, 7, 18, 14, 30),
        returnAt: kst(2026, 7, 18, 21, 30),
        isRoundTrip: true,
        minCount: 15,
        maxCount: 45,
        notes: "서울 서부 노선 (합정 → 신도림 → 인스파이어 아레나). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.hapjeong, pickupOffsetMin: 0 },
          { ...STOP.sindorim, pickupOffsetMin: 20 },
        ],
      },
      {
        mode: "van",
        price: 25000,
        departureAt: kst(2026, 7, 18, 15, 0),
        returnAt: kst(2026, 7, 18, 21, 30),
        isRoundTrip: true,
        minCount: 7,
        maxCount: 12,
        notes: "프리미엄 밴 노선 (강남 → 인스파이어 아레나 직행). 왕복 기준 가격입니다.",
        boardingPoints: [{ ...STOP.gangnam, pickupOffsetMin: 0 }],
      },
    ],
  },
  {
    title: "2026 PLAVE WORLD TOUR 'KEEP IT MANIC' - INCHEON",
    category: "concert",
    eventDate: kst(2026, 8, 8, 18, 0),
    venue: "인천문학경기장 주경기장",
    address: "인천 미추홀구 매소홀로 618",
    lat: "37.4350819",
    lng: "126.6893588",
    description: "PLAVE 월드투어 인천 공연. 카카오 T 셔틀 동시 운행 중인 인기 행사.",
    organizerName: "번개GO 운영팀",
    trips: [
      {
        mode: "bus",
        price: 20000,
        departureAt: kst(2026, 8, 8, 14, 30),
        returnAt: kst(2026, 8, 8, 21, 30),
        isRoundTrip: true,
        minCount: 15,
        maxCount: 45,
        notes: "서울 동남권 노선 (잠실 → 강남 → 인천문학경기장). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.jamsil, pickupOffsetMin: 0 },
          { ...STOP.gangnam, pickupOffsetMin: 25 },
        ],
      },
    ],
  },
  {
    title: "서스테이너블 웨이브 페스티벌 2026",
    category: "festival",
    eventDate: kst(2026, 8, 29, 12, 0),
    venue: "인천문학경기장",
    address: "인천 미추홀구 매소홀로 618",
    lat: "37.4350819",
    lng: "126.6893588",
    description:
      "god, EPIK HIGH, Zion.T 등 출연 (2026.08.29 ~ 08.30). 카카오 T 셔틀 운행 확인된 페스티벌.",
    organizerName: "번개GO 운영팀",
    trips: [
      {
        mode: "bus",
        price: 20000,
        departureAt: kst(2026, 8, 29, 9, 30),
        returnAt: kst(2026, 8, 29, 22, 0),
        isRoundTrip: true,
        minCount: 15,
        maxCount: 45,
        notes: "서울 도심 노선 (서울역 → 사당 → 인천문학경기장). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.seoulStation, pickupOffsetMin: 0 },
          { ...STOP.sadang, pickupOffsetMin: 25 },
        ],
      },
    ],
  },
  {
    title: "2026 전주얼티밋뮤직페스티벌 '점프카니'",
    category: "festival",
    eventDate: kst(2026, 8, 14, 12, 30),
    venue: "전주대학교 인조잔디구장 A,B 일원",
    address: "전북 전주시 완산구 천잠로 303",
    lat: "35.8140107",
    lng: "127.0900384",
    description:
      "전주 대표 뮤직 페스티벌 (2026.08.14 ~ 08.16). 핸디버스 서울발 왕복 35,000원 참고, 초기 프로모션 가격 적용.",
    organizerName: "번개GO 운영팀",
    trips: [
      {
        mode: "bus",
        price: 33000,
        departureAt: kst(2026, 8, 14, 9, 0),
        returnAt: kst(2026, 8, 15, 0, 30),
        isRoundTrip: true,
        minCount: 20,
        maxCount: 45,
        notes: "서울 노선 (서울역 → 사당 → 전주, 약 3시간 소요). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.seoulStation, pickupOffsetMin: 0 },
          { ...STOP.sadang, pickupOffsetMin: 30 },
        ],
      },
      {
        mode: "bus",
        price: 25000,
        departureAt: kst(2026, 8, 14, 10, 0),
        returnAt: kst(2026, 8, 15, 0, 30),
        isRoundTrip: true,
        minCount: 20,
        maxCount: 45,
        notes: "대전 노선 (대전역 → 전주, 약 1시간 30분 소요). 왕복 기준 가격입니다.",
        boardingPoints: [{ ...STOP.daejeon, pickupOffsetMin: 0 }],
      },
    ],
  },
  {
    title: "제29회 보령머드축제",
    category: "festival",
    eventDate: kst(2026, 7, 25, 11, 0),
    venue: "대천해수욕장 머드광장",
    address: "충남 보령시 신흑동 머드광장",
    lat: "36.3211881",
    lng: "126.5107335",
    description:
      "대한민국 대표 여름 축제 (2026.07.24 ~ 08.09). 카카오 T 셔틀 운행 확인. 주말 당일치기 노선.",
    organizerName: "번개GO 운영팀",
    trips: [
      {
        mode: "bus",
        price: 28000,
        departureAt: kst(2026, 7, 25, 8, 0),
        returnAt: kst(2026, 7, 25, 19, 0),
        isRoundTrip: true,
        minCount: 20,
        maxCount: 45,
        notes: "서울 노선 (사당 → 수원 → 대천해수욕장, 약 2시간 30분). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.sadang, pickupOffsetMin: 0 },
          { ...STOP.suwon, pickupOffsetMin: 40 },
        ],
      },
    ],
  },
  {
    title: "NCT DREAM 10주년 기념 콘서트",
    category: "concert",
    eventDate: kst(2026, 8, 22, 18, 0),
    venue: "인스파이어 아레나",
    address: "인천 중구 공항문화로 127",
    lat: "37.4405756",
    lng: "126.4207357",
    description: "NCT DREAM 데뷔 10주년 기념 공연. 버스타다 20,000원~ 참고.",
    organizerName: "번개GO 운영팀",
    trips: [
      {
        mode: "bus",
        price: 19000,
        departureAt: kst(2026, 8, 22, 14, 30),
        returnAt: kst(2026, 8, 22, 21, 30),
        isRoundTrip: true,
        minCount: 15,
        maxCount: 45,
        notes: "서울 서남권 노선 (신도림 → 부평 → 인스파이어 아레나). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.sindorim, pickupOffsetMin: 0 },
          { ...STOP.bupyeong, pickupOffsetMin: 25 },
        ],
      },
    ],
  },
  {
    title: "2026 VERNON THE 8 [V8] LIVE - GOYANG",
    category: "concert",
    eventDate: kst(2026, 7, 11, 18, 0),
    venue: "킨텍스 제1전시장",
    address: "경기 고양시 일산서구 킨텍스로 217-60",
    lat: "37.6683333",
    lng: "126.7458333",
    description: "세븐틴 버논 솔로 라이브. 버스타다 20,000원~ 참고, 임박 행사로 조기 마감 예상.",
    organizerName: "번개GO 운영팀",
    trips: [
      {
        mode: "bus",
        price: 19000,
        departureAt: kst(2026, 7, 11, 14, 30),
        returnAt: kst(2026, 7, 11, 21, 30),
        isRoundTrip: true,
        minCount: 15,
        maxCount: 45,
        notes: "서울 노선 (강남 → 합정 → 킨텍스). 왕복 기준 가격입니다.",
        boardingPoints: [
          { ...STOP.gangnam, pickupOffsetMin: 0 },
          { ...STOP.hapjeong, pickupOffsetMin: 25 },
        ],
      },
    ],
  },
];

// ─── 실행 ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed] DATABASE_URL 환경 변수가 설정되어 있지 않습니다.");
    process.exit(1);
  }
  // Use the same pool-config parsing as server/db.ts (handles the `?ssl=true`
  // query param TiDB requires — drizzle(url) alone passes ssl as a raw string,
  // which mysql2 rejects with "SSL profile must be an object").
  const db = drizzle(createPool(buildMysqlPoolConfig(process.env.DATABASE_URL)));

  let createdEvents = 0;
  let createdTrips = 0;
  let createdPoints = 0;
  let skipped = 0;

  for (const seed of SEED_EVENTS) {
    // 같은 제목의 이벤트가 이미 있으면 건너뜀 (중복 실행 방지)
    const existing = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.title, seed.title))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[seed] SKIP (이미 존재): ${seed.title}`);
      skipped++;
      continue;
    }

    const eventData: InsertEvent = {
      title: seed.title,
      category: seed.category,
      eventDate: seed.eventDate,
      venue: seed.venue,
      address: seed.address,
      lat: seed.lat,
      lng: seed.lng,
      description: seed.description,
      organizerName: seed.organizerName,
      status: "active",
      creatorId: null, // 시스템(운영팀) 생성
    };
    const eventResult = await db.insert(events).values(eventData);
    const eventId = (eventResult[0] as any).insertId as number;
    createdEvents++;
    console.log(`[seed] EVENT #${eventId} 생성: ${seed.title}`);

    for (const t of seed.trips) {
      const tripData: InsertTrip = {
        eventId,
        mode: t.mode,
        status: "collecting",
        minCount: t.minCount ?? 15,
        maxCount: t.maxCount ?? 45,
        currentCount: 0,
        price: t.price,
        departureAt: t.departureAt,
        returnAt: t.returnAt ?? null,
        isRoundTrip: t.isRoundTrip,
        operatorName: "번개GO 제휴 운수사",
        notes: t.notes,
        creatorId: null,
      };
      const tripResult = await db.insert(trips).values(tripData);
      const tripId = (tripResult[0] as any).insertId as number;
      createdTrips++;

      for (let i = 0; i < t.boardingPoints.length; i++) {
        const bp = t.boardingPoints[i];
        const pickupTime = new Date(
          t.departureAt.getTime() + bp.pickupOffsetMin * 60 * 1000
        );
        const bpData: InsertBoardingPoint = {
          tripId,
          name: bp.name,
          address: bp.address,
          lat: bp.lat,
          lng: bp.lng,
          pickupTime,
          order: i,
        };
        await db.insert(boardingPoints).values(bpData);
        createdPoints++;
      }
      console.log(
        `[seed]   └ TRIP #${tripId} (${t.mode}, ${t.price.toLocaleString()}원, 탑승포인트 ${t.boardingPoints.length}곳)`
      );
    }
  }

  console.log(
    `\n[seed] 완료 — 이벤트 ${createdEvents}건, 셔틀 ${createdTrips}건, 탑승포인트 ${createdPoints}건 생성 (건너뜀 ${skipped}건)`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] 실패:", err);
  process.exit(1);
});
