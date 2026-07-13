// Usage: node scripts/apply-migration.cjs <번호>
//   예) node scripts/apply-migration.cjs 0017
// drizzle/ 폴더에서 해당 번호로 시작하는 SQL 파일을 찾아
// statement-breakpoint 단위로 순차 실행합니다.
// (기존 apply-0002 ~ apply-0016-migration.cjs 를 대체)
require('dotenv/config');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const num = process.argv[2];
if (!num || !/^\d{4}$/.test(num)) {
  console.error('Usage: node scripts/apply-migration.cjs <4자리 번호>  예) 0017');
  process.exit(1);
}

const drizzleDir = path.join(__dirname, '..', 'drizzle');
const match = fs.readdirSync(drizzleDir).find((f) => f.startsWith(`${num}_`) && f.endsWith('.sql'));
if (!match) {
  console.error(`drizzle/${num}_*.sql 파일을 찾을 수 없습니다.`);
  process.exit(1);
}
const sqlPath = path.join(drizzleDir, match);

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

async function main() {
  console.log(`applying ${match} to database "${config.database}"`);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  const conn = await mysql.createConnection(config);
  try {
    for (const stmt of statements) {
      await conn.query(stmt);
      console.log('applied:', stmt.slice(0, 60).replace(/\n/g, ' '), '...');
    }
    console.log(`migration-${num}-ready`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
