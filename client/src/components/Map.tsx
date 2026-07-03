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
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${APP_KEY}&autoload=false&libraries=services`;
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
export function createDotMarker(map: any, position: MapLatLng, color: string, title?: string) {
  const { kakao } = window;
  const content = document.createElement("div");
  content.style.width = "14px";
  content.style.height = "14px";
  content.style.borderRadius = "50%";
  content.style.background = color;
  content.style.border = "2px solid white";
  content.style.boxShadow = "0 0 2px rgba(0,0,0,0.4)";
  if (title) content.title = title;

  return new kakao.maps.CustomOverlay({
    map,
    position: new kakao.maps.LatLng(position.lat, position.lng),
    content,
    yAnchor: 0.5,
  });
}
