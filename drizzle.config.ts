import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

const parsed = new URL(connectionString);
const sslParam = parsed.searchParams.get("ssl");
const ssl = sslParam === "true" || sslParam === "1" ? { rejectUnauthorized: false } : undefined;

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\/+/, ""),
    ssl,
  },
});
