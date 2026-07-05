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
  ssl: sslParam === 'true' || sslParam === '1' ? { rejectUnauthorized: false } : undefined,
  multipleStatements: false,
};

const sqlPath = path.join(__dirname, '..', 'drizzle', '0006_next_xavin.sql');
const raw = fs.readFileSync(sqlPath, 'utf8');
const statements = raw
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean);

(async () => {
  const conn = await mysql.createConnection(config);
  for (const stmt of statements) {
    await conn.query(stmt);
    console.log('applied:', stmt.slice(0, 60).replace(/\n/g, ' '), '...');
  }
  await conn.end();
  console.log('migration-0006-ready');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
