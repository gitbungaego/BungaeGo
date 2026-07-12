/**
 * 빈 DB에 drizzle/*.sql 마이그레이션을 파일명 순서대로 전부 적용합니다.
 * drizzle-kit migrate는 0000 baseline 파일 부재로 작동하지 않아(docs/DEPLOYMENT.md
 * "알려진 부채" 참고), 완전히 새로운(비어 있는) DB를 부트스트랩할 때만 쓰는 스크립트입니다.
 * 기존 DB에 증분 적용할 때는 scripts/apply-00NN-migration.cjs를 개별 사용하세요.
 *
 * 사용법: DATABASE_URL=<빈 DB> node scripts/migrate-fresh-db.cjs
 */
require('dotenv/config');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const url = new URL(process.env.DATABASE_URL);
const sslParam = url.searchParams.get('ssl');
const config = {
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\/+/, ''),
  ssl: sslParam === 'true' || sslParam === '1' ? { rejectUnauthorized: true } : undefined,
  multipleStatements: false,
};

const drizzleDir = path.join(__dirname, '..', 'drizzle');
const migrationFiles = fs
  .readdirSync(drizzleDir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

(async () => {
  const conn = await mysql.createConnection(config);
  console.log(`target: ${config.host}/${config.database}`);
  console.log(`${migrationFiles.length}개 마이그레이션 파일 적용 시작\n`);

  for (const file of migrationFiles) {
    const raw = fs.readFileSync(path.join(drizzleDir, file), 'utf8');
    const statements = raw
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    console.log(`--- ${file} (${statements.length}문) ---`);
    for (const stmt of statements) {
      await conn.query(stmt);
    }
  }

  await conn.end();
  console.log('\n전체 마이그레이션 적용 완료');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
