import { describe, expect, it } from "vitest";
import { resolveTicketUnitPrice } from "./reservationFlow";

// 탑승권 종류별 단가 규칙 — 가격은 항상 서버가 트립 값으로 계산한다.
describe("resolveTicketUnitPrice", () => {
  const roundTrip = { price: 20000, isRoundTrip: true, oneWayPrice: 12000 };

  it("round는 항상 trip.price", () => {
    expect(resolveTicketUnitPrice(roundTrip, "round")).toBe(20000);
    expect(resolveTicketUnitPrice({ price: 9000, isRoundTrip: false, oneWayPrice: null }, "round")).toBe(9000);
  });

  it("행사장행/귀가행은 oneWayPrice", () => {
    expect(resolveTicketUnitPrice(roundTrip, "outbound")).toBe(12000);
    expect(resolveTicketUnitPrice(roundTrip, "inbound")).toBe(12000);
  });

  it("왕복 셔틀이 아니면 편도 선택 거부", () => {
    expect(() =>
      resolveTicketUnitPrice({ price: 9000, isRoundTrip: false, oneWayPrice: 5000 }, "outbound")
    ).toThrow(/왕복 셔틀이 아니라/);
  });

  it("편도가 미지정이면 편도 선택 거부", () => {
    expect(() =>
      resolveTicketUnitPrice({ price: 20000, isRoundTrip: true, oneWayPrice: null }, "inbound")
    ).toThrow(/편도 탑승권을 판매하지 않/);
  });
});
