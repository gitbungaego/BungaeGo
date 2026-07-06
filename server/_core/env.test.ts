import { afterEach, describe, expect, it } from "vitest";
import { validateRequiredEnv } from "./env";

describe("validateRequiredEnv", () => {
  const original = { JWT_SECRET: process.env.JWT_SECRET, DATABASE_URL: process.env.DATABASE_URL };

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("throws when JWT_SECRET is missing", () => {
    process.env.JWT_SECRET = "";
    process.env.DATABASE_URL = "mysql://user:pass@host:3306/db";
    expect(() => validateRequiredEnv()).toThrow(/JWT_SECRET/);
  });

  it("throws when DATABASE_URL is missing", () => {
    process.env.JWT_SECRET = "some-secret";
    delete process.env.DATABASE_URL;
    expect(() => validateRequiredEnv()).toThrow(/DATABASE_URL/);
  });

  it("does not throw when both are set", () => {
    process.env.JWT_SECRET = "some-secret";
    process.env.DATABASE_URL = "mysql://user:pass@host:3306/db";
    expect(() => validateRequiredEnv()).not.toThrow();
  });
});
