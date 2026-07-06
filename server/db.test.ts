import { describe, expect, it } from "vitest";
import { buildMysqlPoolConfig, isRecoverableDatabaseError } from "./db";

describe("buildMysqlPoolConfig", () => {
  it("parses Railway-style ssl=true connection strings", () => {
    const config = buildMysqlPoolConfig(
      "mysql://user:pass@host:3306/db?ssl=true"
    );

    expect(config.host).toBe("host");
    expect(config.user).toBe("user");
    expect(config.password).toBe("pass");
    expect(config.database).toBe("db");
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("leaves ssl disabled when explicitly false", () => {
    const config = buildMysqlPoolConfig(
      "mysql://user:pass@host:3306/db?ssl=false"
    );

    expect(config.ssl).toBeUndefined();
  });

  it("treats missing-table and permission errors as recoverable", () => {
    expect(isRecoverableDatabaseError(new Error("Table 'users' doesn't exist"))).toBe(true);
    expect(isRecoverableDatabaseError(new Error("CREATE command denied to user"))).toBe(true);
    expect(isRecoverableDatabaseError(new Error("ECONNRESET"))).toBe(true);
    expect(isRecoverableDatabaseError(new Error("Unexpected failure"))).toBe(false);
  });
});
