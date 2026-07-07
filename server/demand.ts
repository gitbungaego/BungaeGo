import type { RideRequestOrigin } from "./db";

// Grid cell precision: rounding lat/lng to 2 decimal places snaps every origin
// onto a ~1.1km grid before aggregation, so the response can never carry more
// positional precision than that regardless of the real origin coordinates.
const GRID_DECIMAL_PLACES = 2;

export interface DemandGridCell {
  lat: number;
  lng: number;
  count: number;
  seats: number;
}

function roundToGrid(value: number): number {
  const factor = 10 ** GRID_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
}

// Pure aggregation: groups raw ride-request origins onto the demand grid.
// Deliberately takes only { originLat, originLng, seats } — never a userId,
// name, phone, or address — so there is nothing sensitive in scope to leak
// into the returned cells even by mistake.
export function buildDemandGrid(origins: RideRequestOrigin[]): DemandGridCell[] {
  const grid = new Map<string, DemandGridCell>();

  for (const origin of origins) {
    const lat = roundToGrid(Number(origin.originLat));
    const lng = roundToGrid(Number(origin.originLng));
    const key = `${lat.toFixed(GRID_DECIMAL_PLACES)},${lng.toFixed(GRID_DECIMAL_PLACES)}`;

    const existing = grid.get(key);
    if (existing) {
      existing.count += 1;
      existing.seats += origin.seats;
    } else {
      grid.set(key, { lat, lng, count: 1, seats: origin.seats });
    }
  }

  return Array.from(grid.values());
}
