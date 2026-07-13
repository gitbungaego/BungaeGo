import { getLatestConsentByUserAndType, insertConsent } from "./db";
import type { Consent } from "../drizzle/schema";

export const CONSENT_VERSIONS: Record<string, string> = {
  tos: "2026-01-01",
  // 번개팅 별도 이용약관 (본인 사진만 허용·타인/선정적 사진 금지·위반 시 블라인드, spec §3-2).
  bungaeting_tos: "2026-01-01",
};

export function isConsentCurrent(latest: Consent | undefined, currentVersion: string): boolean {
  return latest?.version === currentVersion;
}

export async function recordConsent(userId: number, type: string, version: string): Promise<void> {
  await insertConsent({ userId, type, version, agreedAt: new Date() });
}

export async function hasConsent(userId: number, type: string): Promise<boolean> {
  const currentVersion = CONSENT_VERSIONS[type];
  if (!currentVersion) {
    throw new Error(`hasConsent: unknown consent type "${type}" (not registered in CONSENT_VERSIONS)`);
  }
  const latest = await getLatestConsentByUserAndType(userId, type);
  return isConsentCurrent(latest, currentVersion);
}
