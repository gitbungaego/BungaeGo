export interface GroupableRequest {
  id: number;
  targetArrivalAt: Date;
}

export function computeGroupKey(
  eventId: number,
  targetArrivalAt: Date,
  bucketSizeMinutes: number
): string {
  const bucketMs = bucketSizeMinutes * 60000;
  const bucketIndex = Math.floor(targetArrivalAt.getTime() / bucketMs);
  return `${eventId}_${bucketIndex}`;
}

export function groupRequests<T extends GroupableRequest>(
  eventId: number,
  requests: T[],
  bucketSizeMinutes: number
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const request of requests) {
    const key = computeGroupKey(eventId, request.targetArrivalAt, bucketSizeMinutes);
    const existing = groups.get(key);
    if (existing) {
      existing.push(request);
    } else {
      groups.set(key, [request]);
    }
  }

  return groups;
}
