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

/**
 * 지정 좌표가 지도 "정중앙"에 오도록 이동한다.
 * Kakao 지도는 생성 이후 컨테이너 크기가 바뀌면(폰트 로딩·레이아웃 변동 등) 내부
 * 크기 캐시가 어긋나 setCenter가 시각적으로 중앙에서 벗어나 보일 수 있다 —
 * 항상 relayout()으로 크기를 재계산한 뒤 센터를 잡는다. 레벨을 함께 바꿀 때도
 * setLevel → setCenter 순서로 호출해 최종 중심이 정확히 좌표에 오게 한다.
 */
export function centerMapOn(map: any, position: MapLatLng, level?: number) {
  const { kakao } = window;
  if (!map || !kakao?.maps) return;
  map.relayout();
  if (level != null) map.setLevel(level);
  map.setCenter(new kakao.maps.LatLng(position.lat, position.lng));
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
  /** Muted (smaller, desaturated) styling for a boarding point that belongs to a non-selected trip. */
  muted?: boolean;
  title?: string;
  onClick?: () => void;
}

// Kakao brand yellow, matching the app's Kakao-login button elsewhere.
const BOARDING_POINT_COLOR = "#FEE500";

// A classic map teardrop pin, tip at the bottom center so it points at the
// exact coordinate. viewBox is 28x36; callers pick a pixel size and the image
// scales, with the anchor offset placed at the tip.
function teardropSvg(size: number, opts: { fill: string; stroke: string; inner: string; opacity?: number }): { dataUri: string; width: number; height: number } {
  const width = size;
  const height = Math.round(size * (36 / 28));
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 28 36"${opts.opacity != null ? ` opacity="${opts.opacity}"` : ""}>` +
      `<path d="M14 1 C7.096 1 1.5 6.596 1.5 13.5 C1.5 22 14 35 14 35 C14 35 26.5 22 26.5 13.5 C26.5 6.596 20.904 1 14 1 Z" fill="${opts.fill}" stroke="${opts.stroke}" stroke-width="1.5"/>` +
      opts.inner +
      `</svg>`
  );
  return { dataUri: `data:image/svg+xml;charset=UTF-8,${svg}`, width, height };
}

/**
 * Numbered brand-yellow teardrop pin for a trip's boarding point. The selected
 * trip's stops render large and full-color; every other trip's stops render
 * smaller and desaturated. A custom SVG marker image (not the default Kakao
 * pin), on a kakao.maps.Marker so it can still be clustered.
 */
export function createBoardingPointMarker(map: any, position: MapLatLng, options: BoardingPointMarkerOptions = {}) {
  const { label, muted = false, title, onClick } = options;
  const { kakao } = window;
  const size = muted ? 26 : 36;
  const fill = muted ? "#E5E7EB" : BOARDING_POINT_COLOR;
  const textColor = muted ? "#6b7280" : "#111827";
  const inner = label
    ? `<text x="14" y="18" text-anchor="middle" font-size="13" font-weight="800" fill="${textColor}" font-family="Arial, sans-serif">${label}</text>`
    : "";
  const { dataUri, width, height } = teardropSvg(size, {
    fill,
    stroke: "#ffffff",
    inner,
    opacity: muted ? 0.85 : 1,
  });
  const image = new kakao.maps.MarkerImage(
    dataUri,
    new kakao.maps.Size(width, height),
    { offset: new kakao.maps.Point(width / 2, height) }
  );
  const marker = new kakao.maps.Marker({
    map,
    position: new kakao.maps.LatLng(position.lat, position.lng),
    title,
    image,
    zIndex: muted ? 1 : 3,
  });
  if (onClick) kakao.maps.event.addListener(marker, "click", onClick);
  return marker;
}

/**
 * Destination pin: a black teardrop with a white star in the head, clearly
 * distinct from the yellow boarding pins. One per event (the venue), not
 * clustered.
 */
export function createArrivalMarker(map: any, position: MapLatLng, title?: string) {
  const { kakao } = window;
  const star = `<path d="M14 8 l1.6 3.35 3.7 .38 -2.75 2.5 .78 3.65 -3.33 -1.9 -3.33 1.9 .78 -3.65 -2.75 -2.5 3.7 -.38 Z" fill="#ffffff"/>`;
  const { dataUri, width, height } = teardropSvg(38, {
    fill: "#111827",
    stroke: "#ffffff",
    inner: star,
  });
  const image = new kakao.maps.MarkerImage(
    dataUri,
    new kakao.maps.Size(width, height),
    { offset: new kakao.maps.Point(width / 2, height) }
  );
  return new kakao.maps.Marker({
    map,
    position: new kakao.maps.LatLng(position.lat, position.lng),
    title,
    image,
    zIndex: 5,
  });
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
