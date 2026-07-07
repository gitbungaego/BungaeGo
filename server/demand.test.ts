import { describe, expect, it } from "vitest";
import { buildDemandGrid } from "./demand";
import type { RideRequestOrigin } from "./db";

function origin(originLat: string, originLng: string, seats = 1): RideRequestOrigin {
  return { originLat, originLng, seats };
}

describe("buildDemandGrid", () => {
  it("merges multiple requests in the same ~1.1km grid cell into one cell", () => {
    const cells = buildDemandGrid([
      origin("37.501234", "127.039876", 2),
      origin("37.503456", "127.036543", 1), // rounds to the same 2-decimal cell
      origin("37.5049", "127.0399", 3), // still same cell (37.50, 127.04)
    ]);

    expect(cells).toHaveLength(1);
    expect(cells[0]).toEqual({ lat: 37.5, lng: 127.04, count: 3, seats: 6 });
  });

  it("keeps requests in different grid cells separate", () => {
    const cells = buildDemandGrid([
      origin("37.50", "127.04", 1),
      origin("37.60", "127.10", 2),
    ]);

    expect(cells).toHaveLength(2);
    expect(cells).toEqual(
      expect.arrayContaining([
        { lat: 37.5, lng: 127.04, count: 1, seats: 1 },
        { lat: 37.6, lng: 127.1, count: 1, seats: 2 },
      ])
    );
  });

  it("never returns coordinates with more than 2 decimal places of precision", () => {
    const cells = buildDemandGrid([
      origin("37.123456789", "127.987654321", 1),
      origin("35.999951", "129.000049", 4),
    ]);

    for (const cell of cells) {
      expect(cell.lat).toBe(Number(cell.lat.toFixed(2)));
      expect(cell.lng).toBe(Number(cell.lng.toFixed(2)));
    }
  });

  it("only ever returns lat/lng/count/seats - no identifying fields", () => {
    const cells = buildDemandGrid([origin("37.50", "127.04", 1)]);
    expect(Object.keys(cells[0]).sort()).toEqual(["count", "lat", "lng", "seats"]);
  });

  it("returns an empty array for no origins", () => {
    expect(buildDemandGrid([])).toEqual([]);
  });
});
