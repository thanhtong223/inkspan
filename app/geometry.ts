import type {
  HandFrame,
  Point,
  QualityProfile,
  TrackedHand,
  TrackedTip,
  ZoneGeometry,
} from "./types";

export const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;
export const FINGERTIP_PARENT_INDICES = [3, 7, 11, 15, 19] as const;
export const FINGERTIP_GUIDE_INDICES = [2, 6, 10, 14, 18] as const;
const PALM_INDICES = [0, 5, 9, 13, 17] as const;

export const SYNTHETIC_TIPS: Point[] = [
  { x: 0.15, y: 0.25 },
  { x: 0.16, y: 0.37 },
  { x: 0.17, y: 0.49 },
  { x: 0.17, y: 0.61 },
  { x: 0.16, y: 0.73 },
  { x: 0.85, y: 0.25 },
  { x: 0.84, y: 0.37 },
  { x: 0.83, y: 0.49 },
  { x: 0.83, y: 0.61 },
  { x: 0.84, y: 0.73 },
];

export function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function cameraPointToViewport(
  point: Point,
  videoAspect: number,
  viewportAspect: number,
): Point {
  if (
    !Number.isFinite(videoAspect) ||
    !Number.isFinite(viewportAspect) ||
    videoAspect <= 0 ||
    viewportAspect <= 0
  ) {
    return point;
  }

  if (videoAspect > viewportAspect) {
    const visibleWidth = viewportAspect / videoAspect;
    const cropLeft = (1 - visibleWidth) * 0.5;
    return {
      x: (point.x - cropLeft) / visibleWidth,
      y: point.y,
    };
  }

  const visibleHeight = videoAspect / viewportAspect;
  const cropTop = (1 - visibleHeight) * 0.5;
  return {
    x: point.x,
    y: (point.y - cropTop) / visibleHeight,
  };
}

export function coverCrop(
  videoWidth: number,
  videoHeight: number,
  viewportAspect: number,
) {
  const videoAspect = videoWidth / videoHeight;
  let x = 0;
  let y = 0;
  let width = videoWidth;
  let height = videoHeight;

  if (videoAspect > viewportAspect) {
    width = videoHeight * viewportAspect;
    x = (videoWidth - width) * 0.5;
  } else if (videoAspect < viewportAspect) {
    height = videoWidth / viewportAspect;
    y = (videoHeight - height) * 0.5;
  }

  return { x, y, width, height };
}

export function projectFingertip(
  tip: Point,
  parent: Point,
  extension = 0.1,
): Point {
  return {
    x: tip.x + (tip.x - parent.x) * extension,
    y: tip.y + (tip.y - parent.y) * extension,
  };
}

export function deriveFingertips(landmarks: Point[]): Point[] {
  if (landmarks.length !== 21) return [];

  return FINGERTIP_INDICES.map((tipIndex, finger) => {
    const tip = landmarks[tipIndex];
    const parent = landmarks[FINGERTIP_PARENT_INDICES[finger]];
    const guide = landmarks[FINGERTIP_GUIDE_INDICES[finger]];
    const distal = { x: tip.x - parent.x, y: tip.y - parent.y };
    const prior = { x: parent.x - guide.x, y: parent.y - guide.y };
    const distalLength = Math.hypot(distal.x, distal.y);
    const priorLength = Math.hypot(prior.x, prior.y);
    const alignment =
      distalLength > 0 && priorLength > 0
        ? (distal.x * prior.x + distal.y * prior.y) /
          (distalLength * priorLength)
        : 0;
    const extension = alignment > 0.35 ? 0.1 : 0.04;
    return projectFingertip(tip, parent, extension);
  });
}

export function isValidZone(points: [Point, Point, Point, Point]) {
  const widthTop = Math.hypot(
    points[1].x - points[0].x,
    points[1].y - points[0].y,
  );
  const widthBottom = Math.hypot(
    points[2].x - points[3].x,
    points[2].y - points[3].y,
  );
  return (
    points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ) &&
    widthTop > 0.012 &&
    widthBottom > 0.012
  );
}

export function createZones(
  leftTips: Point[],
  rightTips: Point[],
): ZoneGeometry[] {
  if (leftTips.length !== 5 || rightTips.length !== 5) return [];

  const zones: ZoneGeometry[] = [];
  for (let index = 0; index < 4; index += 1) {
    const points: [Point, Point, Point, Point] = [
      leftTips[index],
      rightTips[index],
      rightTips[index + 1],
      leftTips[index + 1],
    ];
    if (!isValidZone(points)) return [];
    zones.push({ effect: index, points });
  }
  return zones;
}

export function orderHands(hands: TrackedHand[]) {
  return [...hands].sort((first, second) => {
    const firstAnchors =
      first.landmarks?.length === 21
        ? PALM_INDICES.map((index) => first.landmarks[index])
        : first.tips;
    const secondAnchors =
      second.landmarks?.length === 21
        ? PALM_INDICES.map((index) => second.landmarks[index])
        : second.tips;
    const firstCenter =
      firstAnchors.reduce((total, point) => total + point.x, 0) /
      Math.max(firstAnchors.length, 1);
    const secondCenter =
      secondAnchors.reduce((total, point) => total + point.x, 0) /
      Math.max(secondAnchors.length, 1);
    return firstCenter - secondCenter;
  });
}

export function frameToZones(frame: HandFrame) {
  if (frame.hands.length !== 2) return [];
  const ordered = orderHands(frame.hands);
  return createZones(ordered[0].tips, ordered[1].tips);
}

export function flattenTips(frame: HandFrame): TrackedTip[] {
  return orderHands(frame.hands).flatMap((hand) => hand.tips);
}

export function smoothTip(previous: Point, next: Point) {
  const movement = Math.hypot(next.x - previous.x, next.y - previous.y);
  const strength = clamp(0.72 + movement * 5.8, 0.72, 0.94);
  return {
    x: previous.x + (next.x - previous.x) * strength,
    y: previous.y + (next.y - previous.y) * strength,
  };
}

export function interpolateZones(
  current: ZoneGeometry[],
  target: ZoneGeometry[],
): ZoneGeometry[] {
  if (target.length !== 4) return current;
  if (current.length !== 4) {
    return target.map((zone) => ({
      ...zone,
      points: zone.points.map((point) => ({ ...point })) as [
        Point,
        Point,
        Point,
        Point,
      ],
    }));
  }

  return target.map((zone, zoneIndex) => ({
    effect: zone.effect,
    points: zone.points.map((point, pointIndex) => {
      const previous = current[zoneIndex].points[pointIndex];
      const movement = Math.hypot(
        point.x - previous.x,
        point.y - previous.y,
      );
      const strength = clamp(0.44 + movement * 5.4, 0.44, 0.9);
      return {
        x: previous.x + (point.x - previous.x) * strength,
        y: previous.y + (point.y - previous.y) * strength,
      };
    }) as [Point, Point, Point, Point],
  }));
}

export function zoneVelocities(
  previous: ZoneGeometry[],
  next: ZoneGeometry[],
  elapsedMs: number,
): ZoneGeometry[] {
  if (
    previous.length !== 4 ||
    next.length !== 4 ||
    elapsedMs <= 0 ||
    elapsedMs > 180
  ) {
    return [];
  }

  return next.map((zone, zoneIndex) => ({
    effect: zone.effect,
    points: zone.points.map((point, pointIndex) => {
      const oldPoint = previous[zoneIndex].points[pointIndex];
      const velocity = {
        x: (point.x - oldPoint.x) / elapsedMs,
        y: (point.y - oldPoint.y) / elapsedMs,
      };
      const speed = Math.hypot(velocity.x, velocity.y);
      const limit = 0.0024;
      const scale = speed > limit ? limit / speed : 1;
      return { x: velocity.x * scale, y: velocity.y * scale };
    }) as [Point, Point, Point, Point],
  }));
}

export function predictZones(
  zones: ZoneGeometry[],
  velocities: ZoneGeometry[],
  elapsedMs: number,
): ZoneGeometry[] {
  if (zones.length !== 4 || velocities.length !== 4) return zones;
  const predictionMs = clamp(elapsedMs, 0, 180);
  return zones.map((zone, zoneIndex) => ({
    effect: zone.effect,
    points: zone.points.map((point, pointIndex) => {
      const velocity = velocities[zoneIndex].points[pointIndex];
      return {
        x: point.x + velocity.x * predictionMs,
        y: point.y + velocity.y * predictionMs,
      };
    }) as [Point, Point, Point, Point],
  }));
}

export function selectQuality(
  width: number,
  hardwareConcurrency = 4,
): QualityProfile {
  if (width <= 480 || hardwareConcurrency <= 4) {
    return {
      name: "lite",
      detectionFps: 24,
      inferenceWidth: 416,
      renderScale: 1,
    };
  }
  if (width <= 1024 || hardwareConcurrency <= 8) {
    return {
      name: "balanced",
      detectionFps: 30,
      inferenceWidth: 512,
      renderScale: 1.25,
    };
  }
  return {
    name: "high",
    detectionFps: 36,
    inferenceWidth: 640,
    renderScale: 1.5,
  };
}
