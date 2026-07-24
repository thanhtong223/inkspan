export type Point = {
  x: number;
  y: number;
};

export type TrackedTip = Point & {
  finger: number;
  hand: string;
  confidence: number;
};

export type TrackedLandmark = Point & {
  index: number;
  z: number;
};

export type TrackedHand = {
  id: string;
  label: string;
  score: number;
  landmarks: TrackedLandmark[];
  tips: TrackedTip[];
};

export type HandFrame = {
  hands: TrackedHand[];
  timestamp: number;
  inferenceMs: number;
};

export type ZoneGeometry = {
  effect: number;
  points: [Point, Point, Point, Point];
};

export type TrackingState =
  | "permission"
  | "model-loading"
  | "searching"
  | "one-hand"
  | "locked"
  | "recovering"
  | "unsupported"
  | "camera-error";

export type QualityProfile = {
  name: "high" | "balanced" | "lite";
  detectionFps: number;
  inferenceWidth: number;
  renderScale: number;
};

export type WorkerInbound =
  | { type: "init" }
  | { type: "detect"; bitmap: ImageBitmap; timestamp: number };

export type WorkerOutbound =
  | { type: "ready" }
  | { type: "frame"; frame: HandFrame }
  | { type: "error"; message: string };
