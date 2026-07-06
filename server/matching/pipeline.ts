import { dbscan, type DbscanPoint } from "./dbscan";
import { groupRequests } from "./grouping";
import { snapToNearestStop, weiszfeldMedian } from "./geoMedian";
import { buildRoutes, type RouteStop, type StopDemand } from "./routeBuilder";
import { cheapestInsertion, type MergeCandidateCluster, type MergeTargetRoute } from "./merge";
import type { LatLng } from "./haversine";

export interface PipelineRequest {
  id: number;
  lat: number;
  lng: number;
  targetArrivalAt: Date;
  seats: number;
}

export interface PipelineStopCandidate {
  id: number;
  lat: number;
  lng: number;
  name: string;
}

export interface PipelineParams {
  bucketSizeMinutes: number;
  epsMeters: number;
  minPts: number;
  maxSnapDistanceMeters: number;
  maxCapacitySeats: number;
  minCapacitySeats: number;
  avgSpeedKmh: number;
  stopDwellMinutes: number;
  mergeMaxDetourMinutes: number;
  mergeMaxDetourKm: number;
}

export interface PipelineInput {
  eventId: number;
  venue: LatLng;
  requests: PipelineRequest[];
  stopCandidates: PipelineStopCandidate[];
  params: PipelineParams;
}

export interface PipelineClusterResult {
  /** Pipeline-internal synthetic id (negative), matches RouteStop.clusterId. */
  clusterId: number;
  groupKey: string;
  memberRequestIds: number[];
  status: "viable" | "merged" | "failed";
  assignedStopId: number | null;
  assignedLat: number;
  assignedLng: number;
  isAdHocStop: boolean;
  mergedIntoRouteIndex?: number;
}

export interface PipelineRouteResult {
  groupKey: string;
  routeIndex: number;
  stops: RouteStop[];
  totalSeats: number;
  departureAt: Date;
}

export interface PipelineOutput {
  clusters: PipelineClusterResult[];
  routes: PipelineRouteResult[];
  failedRequestIds: number[];
}

function resolveStopForCluster(
  members: PipelineRequest[],
  stopCandidates: PipelineStopCandidate[],
  maxSnapDistanceMeters: number
): { lat: number; lng: number; stopId: number | null; isAdHoc: boolean } {
  const median = weiszfeldMedian(
    members.map((m) => ({ lat: m.lat, lng: m.lng, weight: m.seats }))
  );
  const snapped = snapToNearestStop(median, stopCandidates, maxSnapDistanceMeters);
  if (snapped) {
    return { lat: snapped.stop.lat, lng: snapped.stop.lng, stopId: snapped.stop.id, isAdHoc: false };
  }
  return { lat: median.lat, lng: median.lng, stopId: null, isAdHoc: true };
}

export function runMatchingPipeline(input: PipelineInput): PipelineOutput {
  const { eventId, venue, requests, stopCandidates, params } = input;

  // Local to each call so two calls (e.g. preview then commit) always assign
  // the same synthetic ids for the same input, instead of drifting further
  // negative on every call from a shared module-level counter.
  let syntheticClusterId = -1;
  function nextSyntheticClusterId(): number {
    syntheticClusterId -= 1;
    return syntheticClusterId;
  }

  const groups = groupRequests(eventId, requests, params.bucketSizeMinutes);

  const allClusters: PipelineClusterResult[] = [];
  const allRoutes: PipelineRouteResult[] = [];
  const failedRequestIds: number[] = [];

  let globalRouteIndex = 0;

  for (const [groupKey, groupRequestsList] of Array.from(groups.entries())) {
    const requestById = new Map(groupRequestsList.map((r) => [r.id, r]));
    const dbscanPoints: DbscanPoint[] = groupRequestsList.map((r) => ({
      id: r.id,
      lat: r.lat,
      lng: r.lng,
    }));

    const { clusters: rawClusters, noise } = dbscan(dbscanPoints, {
      epsMeters: params.epsMeters,
      minPts: params.minPts,
    });

    const viableDemands: StopDemand[] = [];
    const clusterResultByClusterId = new Map<number, PipelineClusterResult>();

    for (const rawCluster of rawClusters) {
      const members = rawCluster.map((p) => requestById.get(p.id)!);
      const { lat, lng, stopId, isAdHoc } = resolveStopForCluster(
        members,
        stopCandidates,
        params.maxSnapDistanceMeters
      );
      const clusterId = nextSyntheticClusterId();
      const clusterResult: PipelineClusterResult = {
        clusterId,
        groupKey,
        memberRequestIds: members.map((m) => m.id),
        status: "viable",
        assignedStopId: stopId,
        assignedLat: lat,
        assignedLng: lng,
        isAdHocStop: isAdHoc,
      };
      allClusters.push(clusterResult);
      clusterResultByClusterId.set(clusterId, clusterResult);

      const seats = members.reduce((sum, m) => sum + m.seats, 0);
      viableDemands.push({
        clusterId,
        lat,
        lng,
        seats,
        targetArrivalAt: members[0].targetArrivalAt,
      });
    }

    const { routes: builtRoutes, oversizedDemands } = buildRoutes(viableDemands, {
      maxCapacitySeats: params.maxCapacitySeats,
      minCapacitySeats: params.minCapacitySeats,
      avgSpeedKmh: params.avgSpeedKmh,
      stopDwellMinutes: params.stopDwellMinutes,
      venueLat: venue.lat,
      venueLng: venue.lng,
    });

    // A cluster whose seat count alone exceeds one bus's capacity can't ride
    // any bus as-is - fail it explicitly instead of silently overpacking a bin.
    for (const oversizedDemand of oversizedDemands) {
      const clusterResult = clusterResultByClusterId.get(oversizedDemand.clusterId)!;
      clusterResult.status = "failed";
      failedRequestIds.push(...clusterResult.memberRequestIds);
    }

    const mergeTargetRoutes: MergeTargetRoute[] = builtRoutes.map((route, idx) => ({
      routeIndex: idx,
      stops: route.stops,
      totalSeats: route.totalSeats,
      maxCapacitySeats: params.maxCapacitySeats,
      targetArrivalAt: route.estimatedArrivalAt,
      stopDwellMinutes: params.stopDwellMinutes,
    }));

    // Noise points: each becomes its own single-seat (or multi-seat, if the
    // request itself has multiple seats) leftover candidate for merging.
    const leftoverClusters: MergeCandidateCluster[] = [];
    const leftoverClusterResultByClusterId = new Map<number, PipelineClusterResult>();

    for (const point of noise) {
      const request = requestById.get(point.id)!;
      const clusterId = nextSyntheticClusterId();
      const clusterResult: PipelineClusterResult = {
        clusterId,
        groupKey,
        memberRequestIds: [request.id],
        status: "failed",
        assignedStopId: null,
        assignedLat: request.lat,
        assignedLng: request.lng,
        isAdHocStop: true,
      };
      allClusters.push(clusterResult);
      leftoverClusterResultByClusterId.set(clusterId, clusterResult);
      leftoverClusters.push({
        clusterId,
        lat: request.lat,
        lng: request.lng,
        seats: request.seats,
      });
    }

    const mergeResult = cheapestInsertion(
      leftoverClusters,
      mergeTargetRoutes,
      {
        maxDetourMinutes: params.mergeMaxDetourMinutes,
        maxDetourKm: params.mergeMaxDetourKm,
        avgSpeedKmh: params.avgSpeedKmh,
      },
      venue
    );

    for (const mergedItem of mergeResult.merged) {
      const clusterResult = leftoverClusterResultByClusterId.get(mergedItem.clusterId)!;
      clusterResult.status = "merged";
      clusterResult.mergedIntoRouteIndex = mergedItem.routeIndex;
      const route = mergeTargetRoutes.find((r) => r.routeIndex === mergedItem.routeIndex)!;
      builtRoutes[route.routeIndex] = {
        ...builtRoutes[route.routeIndex],
        stops: route.stops,
        totalSeats: route.totalSeats,
        // The merge may have shifted every stop's pickup time, including the
        // first one, so departureAt must be re-derived rather than kept stale.
        departureAt: route.stops[0]?.pickupTime ?? builtRoutes[route.routeIndex].departureAt,
      };
    }

    for (const unmergedCluster of mergeResult.unmerged) {
      const clusterResult = leftoverClusterResultByClusterId.get(unmergedCluster.clusterId)!;
      failedRequestIds.push(...clusterResult.memberRequestIds);
    }

    for (const route of builtRoutes) {
      allRoutes.push({
        groupKey,
        routeIndex: globalRouteIndex++,
        stops: route.stops,
        totalSeats: route.totalSeats,
        departureAt: route.departureAt,
      });
    }
  }

  return { clusters: allClusters, routes: allRoutes, failedRequestIds };
}
