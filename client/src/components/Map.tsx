/**
 * KAKAO MAPS FRONTEND INTEGRATION - ESSENTIAL GUIDE
 *
 * USAGE FROM PARENT COMPONENT:
 * ======
 *
 * const mapRef = useRef<any>(null);
 *
 * <MapView
 *   initialCenter={{ lat: 37.5665, lng: 126.978 }}
 *   initialZoom={12}
 *   onMapReady={(map) => {
 *     mapRef.current = map; // kakao.maps.Map instance
 *   }}
 * </MapView>
 *
 * ======
 * Kakao Maps has no official TS types in this project, so `window.kakao` and
 * map/marker instances are typed loosely (`any`). Core pieces used here:
 *
 * 📍 MARKER
 * new kakao.maps.Marker({ map, position: new kakao.maps.LatLng(lat, lng) });
 *
 * 🔍 PLACE KEYWORD SEARCH (requires `libraries=services`)
 * const places = new kakao.maps.services.Places();
 * places.keywordSearch("강남역", (data, status) => { ... data[0].x/.y, .place_name, .address_name });
 * Use the exported `searchKeyword()` helper below instead of calling this directly.
 *
 * 🧭 ADDRESS GEOCODING
 * const geocoder = new kakao.maps.services.Geocoder();
 * geocoder.addressSearch("서울 강남구 ...", (result, status) => { ... result[0].x/.y });
 *
 * 🛣️ POLYLINE
 * new kakao.maps.Polyline({ map, path: [new kakao.maps.LatLng(lat,lng), ...], strokeColor: "#2563eb" });
 */

import { useEffect, useRef } from "react";
import { usePersistFn } from "@/hooks/usePersistFn";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    kakao?: any;
  }
}

export interface MapLatLng {
  lat: number;
  lng: number;
}

const APP_KEY = import.meta.env.VITE_KAKAO_MAP_APP_KEY;

let loadPromise: Promise<void> | null = null;

function loadMapScript(): Promise<void> {
  if (window.kakao?.maps) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (!APP_KEY) {
      console.error("VITE_KAKAO_MAP_APP_KEY is not set; Kakao Maps cannot load.");
      loadPromise = null;
      reject(new Error("Missing VITE_KAKAO_MAP_APP_KEY"));
      return;
    }
    const script = document.createElement("script");
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${APP_KEY}&autoload=false&libraries=services,clusterer`;
    script.async = true;
    script.onload = () => {
      window.kakao.maps.load(() => resolve());
    };
    script.onerror = () => {
      console.error("Failed to load Kakao Maps script");
      loadPromise = null;
      reject(new Error("Failed to load Kakao Maps script"));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

// Kakao's zoom "level" is the inverse of the Google-style zoom this app was
// originally designed around (lower level = more zoomed in). Map the old
// 10-19 zoom range onto Kakao's 1-14 level range so existing callers
// (initialZoom={12}, etc.) don't all need to be rewritten.
function zoomToLevel(zoom: number): number {
  return Math.max(1, Math.min(14, 20 - zoom));
}

interface MapViewProps {
  className?: string;
  initialCenter?: MapLatLng;
  initialZoom?: number;
  onMapReady?: (map: any) => void;
}

export function MapView({
  className,
  initialCenter = { lat: 37.5665, lng: 126.978 }, // 서울시청
  initialZoom = 12,
  onMapReady,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);

  const init = usePersistFn(async () => {
    try {
      await loadMapScript();
    } catch {
      return; // Error already logged in loadMapScript.
    }
    if (!mapContainer.current) {
      console.error("Map container not found");
      return;
    }
    const { kakao } = window;
    map.current = new kakao.maps.Map(mapContainer.current, {
      center: new kakao.maps.LatLng(initialCenter.lat, initialCenter.lng),
      level: zoomToLevel(initialZoom),
    });
    map.current.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    if (onMapReady) {
      onMapReady(map.current);
    }
  });

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div ref={mapContainer} className={cn("w-full h-[500px]", className)} />
  );
}

export interface KakaoPlaceResult {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name?: string;
  x: string; // longitude
  y: string; // latitude
}

/** Keyword search across places/addresses, e.g. for a search-as-you-type dropdown. */
export function searchKeyword(keyword: string): Promise<KakaoPlaceResult[]> {
  return new Promise((resolve) => {
    if (!window.kakao?.maps?.services || !keyword.trim()) {
      resolve([]);
      return;
    }
    const places = new window.kakao.maps.services.Places();
    places.keywordSearch(keyword, (data: KakaoPlaceResult[], status: string) => {
      resolve(status === window.kakao.maps.services.Status.OK ? data : []);
    });
  });
}

/** Marker with a custom-colored dot, for cluster/route visualization. */
export function createDotMarker(map: any, position: MapLatLng, color: string, title?: string, onClick?: () => void) {
  const { kakao } = window;
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8" fill="${color}" stroke="white" stroke-width="3"/><circle cx="11" cy="11" r="10" fill="none" stroke="rgba(17,24,39,0.18)" stroke-width="1"/></svg>`
  );
  const image = new kakao.maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${svg}`,
    new kakao.maps.Size(22, 22),
    { offset: new kakao.maps.Point(11, 11) }
  );
  const marker = new kakao.maps.Marker({
    map,
    position: new kakao.maps.LatLng(position.lat, position.lng),
    title,
    image,
  });
  if (onClick) kakao.maps.event.addListener(marker, "click", onClick);
  return marker;
}

export interface BoardingPointMarkerOptions {
  /** Number/text shown inside the marker, e.g. pickup order for the selected trip. */
  label?: string;
  /** Muted (gray/translucent) styling for a boarding point that belongs to a non-selected trip. */
  muted?: boolean;
  title?: string;
  onClick?: () => void;
}

// Kakao brand yellow, matching the app's Kakao-login button elsewhere.
const BOARDING_POINT_COLOR = "#FEE500";

/**
 * Numbered circular marker for a trip's boarding point. Highlighted
 * (brand-yellow, numbered) for the selected trip's stops, muted (gray,
 * translucent) for every other trip's stops shown on the same event-wide map.
 */
export function createBoardingPointMarker(map: any, position: MapLatLng, options: BoardingPointMarkerOptions = {}) {
  const { label, muted = false, title, onClick } = options;
  const { kakao } = window;
  const fill = muted ? "rgba(156,163,175,0.75)" : BOARDING_POINT_COLOR;
  const textColor = muted ? "#4b5563" : "#111827";
  const text = label ? `<text x="15" y="19" text-anchor="middle" font-size="12" font-weight="700" fill="${textColor}" font-family="Arial, sans-serif">${label}</text>` : "";
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="12" fill="${fill}" stroke="white" stroke-width="3"/><circle cx="15" cy="15" r="14" fill="none" stroke="rgba(17,24,39,0.22)" stroke-width="1"/>${text}</svg>`
  );
  const image = new kakao.maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${svg}`,
    new kakao.maps.Size(30, 30),
    { offset: new kakao.maps.Point(15, 15) }
  );
  const marker = new kakao.maps.Marker({
    map,
    position: new kakao.maps.LatLng(position.lat, position.lng),
    title,
    image,
  });
  if (onClick) kakao.maps.event.addListener(marker, "click", onClick);
  return marker;
}

// Same brand yellow as boarding points - demand is "riders who would use a
// boarding point here", so the two are deliberately in the same color family.
const DEMAND_CIRCLE_COLOR = "#FEE500";

export interface DemandCircleOptions {
  radiusMeters: number;
  onClick?: () => void;
}

/** Translucent radius circle for a demand grid cell. Click-through via onClick, not hover. */
export function createDemandCircle(map: any, position: MapLatLng, { radiusMeters, onClick }: DemandCircleOptions) {
  const { kakao } = window;
  const circle = new kakao.maps.Circle({
    center: new kakao.maps.LatLng(position.lat, position.lng),
    radius: radiusMeters,
    strokeWeight: 1,
    strokeColor: DEMAND_CIRCLE_COLOR,
    strokeOpacity: 0.8,
    strokeStyle: "solid",
    fillColor: DEMAND_CIRCLE_COLOR,
    fillOpacity: 0.35,
    map,
  });
  if (onClick) {
    kakao.maps.event.addListener(circle, "click", onClick);
  }
  return circle;
}

/** Small dark-on-white tooltip bubble anchored above a point, e.g. for a clicked demand circle. */
export function createTooltipOverlay(map: any, position: MapLatLng, text: string) {
  const { kakao } = window;
  const content = document.createElement("div");
  content.textContent = text;
  content.style.background = "#111827";
  content.style.color = "#ffffff";
  content.style.fontSize = "12px";
  content.style.fontWeight = "600";
  content.style.padding = "6px 10px";
  content.style.borderRadius = "8px";
  content.style.whiteSpace = "nowrap";
  content.style.boxShadow = "0 2px 8px rgba(0,0,0,0.25)";

  return new kakao.maps.CustomOverlay({
    map,
    position: new kakao.maps.LatLng(position.lat, position.lng),
    content,
    yAnchor: 1.4,
  });
}
