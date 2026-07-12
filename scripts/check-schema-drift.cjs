/**
 * 로컬(소스 오브 트루스) 스키마와 배포 대상 DB의 실제 스키마를
 * information_schema 기준으로 전수 비교합니다.
 *
 * 사용법:
 *   DATABASE_URL=<기준 DB>  TARGET_DATABASE_URL=<비교 대상 DB>  node scripts/check-schema-drift.cjs
 *
 * 기록(DEPLOYMENT.md 마이그레이션 표)을 신뢰하지 않고, 두 DB의 실제
 * SHOW TABLES / DESCRIBE 결과만 비교합니다. exit code 1이면 drift 있음.
 */
require('dotenv/config');
const mysql = require('mysql2/promise');

function parseUrl(raw, label) {
  if (!raw) throw new Error(`${label} is required`);
  const url = new URL(raw);
  const sslParam = url.searchParams.get('ssl');
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\/+/, ''),
    ssl: sslParam === 'true' || sslParam === '1' ? { rejectUnauthorized: true } : undefined,
  };
}

async function loadSchema(conn, database) {
  const [tables] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
    [database]
  );
  const [columns] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database]
  );
  const [indexes] = await conn.query(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
     FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?
     GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME`,
    [database]
  );

  const schema = { tables: new Set(tables.map((t) => t.TABLE_NAME)), columns: new Map(), indexes: new Map() };
  for (const c of columns) {
    if (!schema.columns.has(c.TABLE_NAME)) schema.columns.set(c.TABLE_NAME, new Map());
    schema.columns.get(c.TABLE_NAME).set(c.COLUMN_NAME, {
      type: c.COLUMN_TYPE,
      nullable: c.IS_NULLABLE,
      default: c.COLUMN_DEFAULT,
      key: c.COLUMN_KEY,
      extra: c.EXTRA,
    });
  }
  for (const i of indexes) {
    if (!schema.indexes.has(i.TABLE_NAME)) schema.indexes.set(i.TABLE_NAME, new Map());
    schema.indexes.get(i.TABLE_NAME).set(i.INDEX_NAME, { unique: Number(i.NON_UNIQUE) === 0, cols: i.cols });
  }
  return schema;
}

function diffSchemas(source, target) {
  const issues = [];

  for (const table of source.tables) {
    if (!target.tables.has(table)) {
      issues.push({ type: 'MISSING_TABLE', table });
      continue;
    }
    const sourceCols = source.columns.get(table) || new Map();
    const targetCols = target.columns.get(table) || new Map();
    for (const [colName, colDef] of sourceCols) {
      if (!targetCols.has(colName)) {
        issues.push({ type: 'MISSING_COLUMN', table, column: colName, expected: colDef });
        continue;
      }
      const targetDef = targetCols.get(colName);
      const mismatches = [];
      if (colDef.type !== targetDef.type) mismatches.push(`type ${colDef.type} != ${targetDef.type}`);
      if (colDef.nullable !== targetDef.nullable) mismatches.push(`nullable ${colDef.nullable} != ${targetDef.nullable}`);
      if (mismatches.length > 0) {
        issues.push({ type: 'COLUMN_MISMATCH', table, column: colName, details: mismatches.join(', ') });
      }
    }
    for (const colName of targetCols.keys()) {
      if (!sourceCols.has(colName)) {
        issues.push({ type: 'EXTRA_COLUMN', table, column: colName });
      }
    }

    // 인덱스는 이름이 아니라 (unique, 컬럼 구성)으로 매칭한다 — drizzle이
    // 마이그레이션으로 만든 이름(users_openId_unique)과 최초 baseline이
    // 만든 이름(openId)이 달라도 동일한 제약으로 취급해야 오탐이 없다.
    // PRIMARY는 별도 취급하므로 제외.
    const sourceIdx = source.indexes.get(table) || new Map();
    const targetIdx = target.indexes.get(table) || new Map();
    const sourceSig = new Set(
      [...sourceIdx.entries()].filter(([n]) => n !== 'PRIMARY').map(([, d]) => `${d.unique}:${d.cols}`)
    );
    const targetSig = new Set(
      [...targetIdx.entries()].filter(([n]) => n !== 'PRIMARY').map(([, d]) => `${d.unique}:${d.cols}`)
    );
    for (const [idxName, idxDef] of sourceIdx) {
      if (idxName === 'PRIMARY') continue;
      const sig = `${idxDef.unique}:${idxDef.cols}`;
      if (!targetSig.has(sig)) {
        issues.push({ type: 'MISSING_INDEX', table, index: idxName, expected: idxDef });
      }
    }
    for (const [idxName, idxDef] of targetIdx) {
      if (idxName === 'PRIMARY') continue;
      const sig = `${idxDef.unique}:${idxDef.cols}`;
      if (!sourceSig.has(sig)) {
        issues.push({ type: 'EXTRA_INDEX', table, index: idxName, details: `unique=${idxDef.unique} cols=(${idxDef.cols})` });
      }
    }
  }

  for (const table of target.tables) {
    if (!source.tables.has(table)) {
      issues.push({ type: 'EXTRA_TABLE', table });
    }
  }

  return issues;
}

function formatIssue(issue) {
  switch (issue.type) {
    case 'MISSING_TABLE':
      return `[MISSING_TABLE] ${issue.table} — source에 있으나 target에 없음`;
    case 'EXTRA_TABLE':
      return `[EXTRA_TABLE] ${issue.table} — target에만 있음`;
    case 'MISSING_COLUMN':
      return `[MISSING_COLUMN] ${issue.table}.${issue.column} — target에 없음 (기대: ${issue.expected.type})`;
    case 'EXTRA_COLUMN':
      return `[EXTRA_COLUMN] ${issue.table}.${issue.column} — target에만 있음`;
    case 'COLUMN_MISMATCH':
      return `[COLUMN_MISMATCH] ${issue.table}.${issue.column} — ${issue.details}`;
    case 'MISSING_INDEX':
      return `[MISSING_INDEX] ${issue.table}.${issue.index} — target에 동일 구성(unique=${issue.expected.unique}, cols=(${issue.expected.cols})) 인덱스 없음`;
    case 'EXTRA_INDEX':
      return `[EXTRA_INDEX] ${issue.table}.${issue.index} — target에만 있음 (${issue.details})`;
    default:
      return JSON.stringify(issue);
  }
}

(async () => {
  const sourceConfig = parseUrl(process.env.DATABASE_URL, 'DATABASE_URL');
  const targetConfig = parseUrl(process.env.TARGET_DATABASE_URL, 'TARGET_DATABASE_URL');

  const sourceConn = await mysql.createConnection(sourceConfig);
  const targetConn = await mysql.createConnection(targetConfig);

  const source = await loadSchema(sourceConn, sourceConfig.database);
  const target = await loadSchema(targetConn, targetConfig.database);

  await sourceConn.end();
  await targetConn.end();

  console.log(`source: ${sourceConfig.host}/${sourceConfig.database} (${source.tables.size} tables)`);
  console.log(`target: ${targetConfig.host}/${targetConfig.database} (${target.tables.size} tables)`);
  console.log('');

  const issues = diffSchemas(source, target);

  if (issues.length === 0) {
    console.log('스키마 drift 없음 — source와 target이 정확히 일치합니다.');
    process.exit(0);
  }

  console.log(`drift ${issues.length}건 발견:\n`);
  for (const issue of issues) {
    console.log('  ' + formatIssue(issue));
  }
  process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
