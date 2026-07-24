import {
  FilesetResolver,
  HandLandmarker,
} from "/mediapipe/vision_bundle.mjs";

const FINGERTIP_INDICES = [4, 8, 12, 16, 20];
const WASM_ROOT = `${self.location.origin}/mediapipe`;
const MODEL_URL = `${self.location.origin}/mediapipe/hand_landmarker.task`;

let landmarker = null;

function send(message) {
  self.postMessage(message);
}

function convertResult(result, timestamp, inferenceMs) {
  const hands = result.landmarks.map((landmarks, index) => {
    const category = result.handedness[index]?.[0];
    const label = category?.categoryName || `hand-${index}`;
    const score = category?.score ?? 0.5;
    const trackedLandmarks = landmarks.map((point, landmarkIndex) => ({
      x: 1 - point.x,
      y: point.y,
      z: point.z,
      index: landmarkIndex,
    }));

    return {
      id: `${label.toLowerCase()}-${index}`,
      label,
      score,
      landmarks: trackedLandmarks,
      tips: FINGERTIP_INDICES.map((landmarkIndex, finger) => {
        const point = trackedLandmarks[landmarkIndex];
        return {
          x: point.x,
          y: point.y,
          finger,
          hand: label,
          confidence: score,
        };
      }),
    };
  });

  return { hands, timestamp, inferenceMs };
}

self.onmessage = async (event) => {
  try {
    if (event.data.type === "init") {
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.34,
        minHandPresenceConfidence: 0.32,
        minTrackingConfidence: 0.26,
      });
      send({ type: "ready" });
      return;
    }

    if (!landmarker) {
      event.data.bitmap.close();
      send({ type: "error", message: "Hand tracking is not ready." });
      return;
    }

    const started = performance.now();
    const result = landmarker.detectForVideo(
      event.data.bitmap,
      event.data.timestamp,
    );
    event.data.bitmap.close();
    send({
      type: "frame",
      frame: convertResult(
        result,
        event.data.timestamp,
        performance.now() - started,
      ),
    });
  } catch (error) {
    if (event.data.type === "detect") event.data.bitmap.close();
    send({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Hand tracking could not start on this device.",
    });
  }
};
