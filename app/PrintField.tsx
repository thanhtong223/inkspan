"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  FINGERTIP_INDICES,
  coverCrop,
  deriveFingertips,
  frameToZones,
  interpolateZones,
  orderHands,
  predictZones,
  selectQuality,
  smoothTip,
  zoneVelocities,
} from "./geometry";
import { createPrintRenderer, type PrintRenderer } from "./renderer";
import type {
  HandFrame,
  Point,
  TrackingState,
  WorkerOutbound,
  ZoneGeometry,
} from "./types";
import type {
  HandLandmarker,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { trackEvent } from "./analytics";

const STATUS_COPY: Record<TrackingState, string> = {
  permission: "Camera ready when you are",
  "model-loading": "Preparing hand tracking",
  searching: "Spread both hands",
  "one-hand": "One hand found · show the other",
  locked: "10 points ready",
  recovering: "Hold that shape",
  unsupported: "Tracking is unavailable",
  "camera-error": "Camera could not start",
};

const RECORDING_LIMIT_MS = 60_000;
const RECORDING_FPS = 30;

function drawRecordingMarks(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const scale = width / 1280;
  const pad = Math.max(18, 28 * scale);
  const paper = "#f2eee3";

  context.save();
  context.textBaseline = "middle";
  context.shadowColor = "rgba(20, 20, 18, 0.42)";
  context.shadowBlur = Math.max(5, 10 * scale);
  context.font = `600 ${Math.max(11, 14 * scale)}px "Helvetica Neue", "Segoe UI", Arial, sans-serif`;
  context.fillStyle = paper;
  context.fillText("INKSPAN", pad, Math.max(24, 32 * scale));
  context.font = `500 ${Math.max(10, 12 * scale)}px "Helvetica Neue", "Segoe UI", Arial, sans-serif`;
  const credit = "@tvthanhhh";
  const creditWidth = context.measureText(credit).width;
  context.fillText(credit, width - pad - creditWidth, height - pad);
  context.restore();
}

function recordingName(extension: string) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  return `inkspan-${stamp}.${extension}`;
}

function formatDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `00:${String(seconds).padStart(2, "0")}`;
}

function resultToFrame(
  result: HandLandmarkerResult,
  timestamp: number,
  inferenceMs: number,
): HandFrame {
  return {
    timestamp,
    inferenceMs,
    hands: result.landmarks.map((landmarks, index) => {
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
    }),
  };
}

export function PrintField() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const rendererRef = useRef<PrintRenderer | null>(null);
  const workerReadyRef = useRef(false);
  const mainLandmarkerRef = useRef<HandLandmarker | null>(null);
  const mainFallbackRef = useRef(false);
  const fallbackStartingRef = useRef(false);
  const fallbackInitializerRef = useRef<() => void>(() => undefined);
  const inferenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectionBusyRef = useRef(false);
  const detectionFrameRef = useRef(0);
  const renderFrameRef = useRef(0);
  const lastDetectionRef = useRef(0);
  const filteredRef = useRef(new Map<string, Point>());
  const zonesRef = useRef<ZoneGeometry[]>([]);
  const targetZonesRef = useRef<ZoneGeometry[]>([]);
  const zoneVelocityRef = useRef<ZoneGeometry[]>([]);
  const lastZoneUpdateRef = useRef(0);
  const opacityRef = useRef(0);
  const recordingUrlRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedRef = useRef(0);
  const recordingFrameRef = useRef(0);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const cameraStartingRef = useRef(false);
  const [quality, setQuality] = useState(() => selectQuality(1024, 4));

  const [trackingState, setTrackingState] =
    useState<TrackingState>("permission");
  const [cameraLive, setCameraLive] = useState(false);
  const [lockNotice, setLockNotice] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingExtension, setRecordingExtension] = useState("webm");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuality(
        selectQuality(window.innerWidth, navigator.hardwareConcurrency),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const processFrame = useCallback((frame: HandFrame) => {
    detectionBusyRef.current = false;
    if (frame.hands.length === 2) {
      const orderedHands = orderHands(frame.hands);
      const smoothed: HandFrame = {
        ...frame,
        hands: orderedHands.map((hand, handIndex) => {
          const landmarks = hand.landmarks.map((landmark) => {
            const key = `screen-${handIndex}-landmark-${landmark.index}`;
            const previous = filteredRef.current.get(key) || landmark;
            const next = smoothTip(previous, landmark);
            filteredRef.current.set(key, next);
            return { ...landmark, ...next };
          });
          const tipPoints = deriveFingertips(landmarks);
          return {
            ...hand,
            landmarks,
            tips: tipPoints.map((point, finger) => ({
              ...point,
              finger,
              hand: hand.label,
              confidence: hand.score,
            })),
          };
        }),
      };
      const zones = frameToZones(smoothed);
      if (zones.length === 4) {
        const now = performance.now();
        zoneVelocityRef.current = zoneVelocities(
          targetZonesRef.current,
          zones,
          now - lastZoneUpdateRef.current,
        );
        targetZonesRef.current = zones;
        lastZoneUpdateRef.current = now;
        if (zonesRef.current.length !== 4) zonesRef.current = zones;
        opacityRef.current = Math.min(1, opacityRef.current + 0.2);
        setTrackingState((current) => {
          if (current !== "locked") {
            setLockNotice(true);
            if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
            lockTimerRef.current = setTimeout(
              () => setLockNotice(false),
              1400,
            );
          }
          return "locked";
        });
        return;
      }
    }

    zonesRef.current = [];
    targetZonesRef.current = [];
    zoneVelocityRef.current = [];
    lastZoneUpdateRef.current = 0;
    opacityRef.current = 0;
    setTrackingState(frame.hands.length === 1 ? "one-hand" : "searching");
  }, []);

  const beginDetection = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    cancelAnimationFrame(detectionFrameRef.current);

    const detect = async (time: number) => {
      const interval = 1000 / quality.detectionFps;
      if (
        !detectionBusyRef.current &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        time - lastDetectionRef.current >= interval
      ) {
        detectionBusyRef.current = true;
        lastDetectionRef.current = time;
        try {
          const videoWidth = video.videoWidth || 1280;
          const videoHeight = video.videoHeight || 720;
          const videoAspect = videoWidth / videoHeight;
          const stage = stageRef.current;
          const viewportAspect =
            stage?.clientWidth && stage.clientHeight
              ? stage.clientWidth / stage.clientHeight
              : videoAspect;
          const crop = coverCrop(
            videoWidth,
            videoHeight,
            viewportAspect,
          );
          const height = Math.max(
            144,
            Math.round(quality.inferenceWidth / viewportAspect),
          );

          if (mainFallbackRef.current && mainLandmarkerRef.current) {
            const inferenceCanvas =
              inferenceCanvasRef.current || document.createElement("canvas");
            inferenceCanvasRef.current = inferenceCanvas;
            if (
              inferenceCanvas.width !== quality.inferenceWidth ||
              inferenceCanvas.height !== height
            ) {
              inferenceCanvas.width = quality.inferenceWidth;
              inferenceCanvas.height = height;
            }
            const context = inferenceCanvas.getContext("2d", {
              alpha: false,
            });
            if (!context) throw new Error("Canvas tracking unavailable");
            context.drawImage(
              video,
              crop.x,
              crop.y,
              crop.width,
              crop.height,
              0,
              0,
              quality.inferenceWidth,
              height,
            );
            const timestamp = performance.now();
            const started = performance.now();
            const result = mainLandmarkerRef.current.detectForVideo(
              inferenceCanvas,
              timestamp,
            );
            processFrame(
              resultToFrame(
                result,
                timestamp,
                performance.now() - started,
              ),
            );
          } else if (workerReadyRef.current && workerRef.current) {
            const bitmap = await createImageBitmap(
              video,
              crop.x,
              crop.y,
              crop.width,
              crop.height,
              {
                resizeWidth: quality.inferenceWidth,
                resizeHeight: height,
                resizeQuality: "high",
              },
            );
            workerRef.current.postMessage(
              { type: "detect", bitmap, timestamp: performance.now() },
              [bitmap],
            );
          } else {
            detectionBusyRef.current = false;
          }
        } catch {
          detectionBusyRef.current = false;
          if (!mainFallbackRef.current) {
            fallbackInitializerRef.current();
          } else {
            setTrackingState("unsupported");
          }
        }
      }
      detectionFrameRef.current = requestAnimationFrame(detect);
    };
    detectionFrameRef.current = requestAnimationFrame(detect);
  }, [processFrame, quality]);

  const initializeMainThreadTracking = useCallback(async () => {
    if (mainLandmarkerRef.current || fallbackStartingRef.current) return;
    fallbackStartingRef.current = true;
    workerRef.current?.terminate();
    workerRef.current = null;
    workerReadyRef.current = false;
    detectionBusyRef.current = false;
    setTrackingState("model-loading");

    try {
      const { FilesetResolver, HandLandmarker } = await import(
        "@mediapipe/tasks-vision"
      );
      const vision = await FilesetResolver.forVisionTasks(
        `${window.location.origin}/mediapipe`,
      );
      mainLandmarkerRef.current =
        await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `${window.location.origin}/mediapipe/hand_landmarker.task`,
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.34,
          minHandPresenceConfidence: 0.32,
          minTrackingConfidence: 0.26,
        });
      mainFallbackRef.current = true;
      setTrackingState("searching");
      beginDetection();
    } catch {
      setTrackingState("unsupported");
    } finally {
      fallbackStartingRef.current = false;
    }
  }, [beginDetection]);

  useEffect(() => {
    fallbackInitializerRef.current = () => {
      void initializeMainThreadTracking();
    };
  }, [initializeMainThreadTracking]);

  const beginRendering = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return false;

    try {
      rendererRef.current = createPrintRenderer(canvas);
    } catch {
      setTrackingState("unsupported");
      return false;
    }

    const render = (time: number) => {
      if (
        rendererRef.current &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        if (zonesRef.current.length === 4) {
          const predictedZones = predictZones(
            targetZonesRef.current,
            zoneVelocityRef.current,
            time - lastZoneUpdateRef.current,
          );
          zonesRef.current = interpolateZones(
            zonesRef.current,
            predictedZones,
          );
          opacityRef.current += (1 - opacityRef.current) * 0.2;
        }
        rendererRef.current.render(
          video,
          zonesRef.current,
          opacityRef.current,
          quality,
        );
      }
      renderFrameRef.current = requestAnimationFrame(render);
    };
    renderFrameRef.current = requestAnimationFrame(render);
    return true;
  }, [quality]);

  const initializeWorker = useCallback(() => {
    if (workerRef.current) return;
    setTrackingState("model-loading");
    const worker = new Worker("/hand-tracker.worker.js", { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      if (event.data.type === "ready") {
        workerReadyRef.current = true;
        setTrackingState("searching");
        beginDetection();
      } else if (event.data.type === "frame") {
        processFrame(event.data.frame);
      } else {
        detectionBusyRef.current = false;
        void initializeMainThreadTracking();
      }
    };
    worker.onerror = () => {
      detectionBusyRef.current = false;
      void initializeMainThreadTracking();
    };
    worker.postMessage({ type: "init" });
  }, [beginDetection, initializeMainThreadTracking, processFrame]);

  const startCamera = useCallback(async () => {
    if (streamRef.current || cameraStartingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setTrackingState("unsupported");
      return;
    }
    cameraStartingRef.current = true;
    setTrackingState("model-loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setCameraLive(true);
      trackEvent("camera_enabled");
      if (!beginRendering()) {
        setTrackingState("unsupported");
        return;
      }
      initializeWorker();
    } catch {
      setTrackingState("camera-error");
    } finally {
      cameraStartingRef.current = false;
    }
  }, [beginRendering, initializeWorker]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      workerRef.current?.terminate();
      mainLandmarkerRef.current?.close();
      rendererRef.current?.destroy();
      cancelAnimationFrame(detectionFrameRef.current);
      cancelAnimationFrame(renderFrameRef.current);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      cancelAnimationFrame(recordingFrameRef.current);
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordingUrlRef.current) {
        URL.revokeObjectURL(recordingUrlRef.current);
      }
    };
  }, []);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    cancelAnimationFrame(recordingFrameRef.current);
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (
      !cameraLive ||
      typeof MediaRecorder === "undefined" ||
      typeof HTMLCanvasElement.prototype.captureStream !== "function"
    ) {
      setRecordingError(
        "Video recording is unavailable in this browser.",
      );
      return;
    }

    const sourceCanvas = canvasRef.current;
    const stage = stageRef.current;
    if (!sourceCanvas || !stage) {
      setRecordingError("The camera is not ready to record yet.");
      return;
    }

    setRecordingError(null);
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
      setRecordingUrl(null);
    }
    const mimeType = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    const compositor = document.createElement("canvas");
    const longestSide = Math.max(stage.clientWidth, stage.clientHeight);
    const outputScale = Math.min(1, 1440 / Math.max(1, longestSide));
    compositor.width = Math.max(1, Math.round(stage.clientWidth * outputScale));
    compositor.height = Math.max(1, Math.round(stage.clientHeight * outputScale));
    const context = compositor.getContext("2d", { alpha: false });
    if (!context) {
      setRecordingError("This browser could not prepare video recording.");
      return;
    }
    const stream = compositor.captureStream(RECORDING_FPS);
    recordingStreamRef.current = stream;

    const drawFrame = () => {
      context.drawImage(
        sourceCanvas,
        0,
        0,
        compositor.width,
        compositor.height,
      );
      drawRecordingMarks(context, compositor.width, compositor.height);
      recordingFrameRef.current = requestAnimationFrame(drawFrame);
    };
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 8_000_000,
      });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setRecordingError("This browser could not start video recording.");
      return;
    }
    setRecordingError(null);
    recordingChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      cancelAnimationFrame(recordingFrameRef.current);
      stream.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      const type = recorder.mimeType || mimeType || "video/webm";
      const extension = type.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(recordingChunksRef.current, { type });
      const url = URL.createObjectURL(blob);
      recordingUrlRef.current = url;
      setRecordingExtension(extension);
      setRecordingUrl(url);
      setRecording(false);
      trackEvent("recording_completed", {
        duration_seconds: Math.round(
          (performance.now() - recordingStartedRef.current) / 1000,
        ),
      });
    };
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (recorder.state === "recording") recorder.stop();
      setRecording(false);
    });
    mediaRecorderRef.current = recorder;
    recordingStartedRef.current = performance.now();
    setRecordingElapsed(0);
    setRecording(true);
    drawFrame();
    recorder.start(250);
    trackEvent("recording_started");
    recordingTimerRef.current = setInterval(() => {
      const elapsed = Math.min(
        RECORDING_LIMIT_MS,
        performance.now() - recordingStartedRef.current,
      );
      setRecordingElapsed(elapsed);
      if (elapsed >= RECORDING_LIMIT_MS) {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }
    }, 100);
  }, [cameraLive]);

  const downloadRecording = () => {
    if (!recordingUrl) return;
    const link = document.createElement("a");
    link.href = recordingUrl;
    link.download = recordingName(recordingExtension);
    link.click();
    trackEvent("recording_downloaded", {
      format: recordingExtension,
    });
  };

  return (
    <main className="print-field" data-state={trackingState}>
      <section className="camera-stage" ref={stageRef}>
      <video ref={videoRef} playsInline muted aria-hidden="true" />
      <canvas ref={canvasRef} aria-label="Live INKSPAN camera" />

      <header className="top-rail">
        <p className="wordmark">INKSPAN</p>
        <p className="privacy-signal">
          <span aria-hidden="true" />
          local camera
        </p>
      </header>

      {!cameraLive && (
        <div className="camera-placeholder" role="status">
          <p>
            {trackingState === "camera-error"
              ? "Camera access was blocked"
              : trackingState === "model-loading"
                ? "Starting camera"
                : "Camera is off"}
          </p>
          <button
            type="button"
            onClick={startCamera}
            disabled={trackingState === "model-loading"}
          >
            {trackingState === "camera-error"
              ? "Try camera again"
              : trackingState === "model-loading"
                ? "Starting…"
                : "Enable camera"}
          </button>
        </div>
      )}

      </section>

      <section className="control-deck" aria-label="Camera controls">
        <div className="guide-block">
          <div
            className={`tracking-status ${lockNotice ? "notice" : ""}`}
            role="status"
            aria-live="polite"
          >
            <span data-state={trackingState} aria-hidden="true" />
            <p>{STATUS_COPY[trackingState]}</p>
          </div>
          <p className="guide-copy">
            Tap record, then raise both hands. Spread or pinch your fingers
            to shape four print fields.
          </p>
        </div>

        <div className="record-transport">
          <button
            className="record-button"
            data-recording={recording ? "true" : "false"}
            type="button"
            disabled={!cameraLive}
            onClick={recording ? stopRecording : startRecording}
            aria-label={recording ? "Stop recording" : "Start recording"}
          >
            <span aria-hidden="true" />
            {recording ? "Stop" : "Record"}
          </button>
          <div className="record-timeline" aria-label="Recording timeline">
            <div>
              <span>{recording ? "REC" : recordingUrl ? "READY" : "IDLE"}</span>
              <time>{formatDuration(recordingElapsed)}</time>
            </div>
            <i>
              <b
                style={{
                  width: `${(recordingElapsed / RECORDING_LIMIT_MS) * 100}%`,
                }}
              />
            </i>
            <small>60 sec maximum</small>
            {recordingError && <small role="alert">{recordingError}</small>}
          </div>
        </div>

        {recordingUrl && !recording && (
          <div className="deck-actions">
            <button
              className="save-recording"
              type="button"
              onClick={downloadRecording}
            >
              Save video
            </button>
          </div>
        )}

        <footer className="deck-footer">
          <p className="creator-credit">
            <a
              href="https://www.instagram.com/tvthanhhh/"
              target="_blank"
              rel="noreferrer"
            >
              @tvthanhhh
            </a>
          </p>
          <nav aria-label="Legal">
            <span>processed locally</span>
            <a
              className="effect-link"
              href="https://convexcam.thanh-tong.com"
              onClick={() =>
                trackEvent("effect_switched", { destination: "convex" })
              }
            >
              Convex Mirror ↗
            </a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
        </footer>
      </section>
    </main>
  );
}
