import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNTHETIC_TIPS,
  cameraPointToViewport,
  coverCrop,
  createZones,
  deriveFingertips,
  frameToZones,
  interpolateZones,
  isValidZone,
  predictZones,
  projectFingertip,
  selectQuality,
  zoneVelocities,
} from "../app/geometry.ts";

function hand(id, xOffset) {
  return {
    id,
    label: id,
    score: 0.98,
    landmarks: [],
    tips: Array.from({ length: 5 }, (_, finger) => ({
      x: xOffset,
      y: 0.24 + finger * 0.12,
      finger,
      hand: id,
      confidence: 0.98,
    })),
  };
}

test("ten fingertip points create four valid effect zones", () => {
  const zones = createZones(
    SYNTHETIC_TIPS.slice(0, 5),
    SYNTHETIC_TIPS.slice(5),
  );
  assert.equal(zones.length, 4);
  assert.deepEqual(
    zones.map((zone) => zone.effect),
    [0, 1, 2, 3],
  );
  assert.ok(zones.every((zone) => isValidZone(zone.points)));
});

test("moving one middle fingertip changes only its neighboring zones", () => {
  const before = createZones(
    SYNTHETIC_TIPS.slice(0, 5),
    SYNTHETIC_TIPS.slice(5),
  );
  const moved = SYNTHETIC_TIPS.map((point) => ({ ...point }));
  moved[2].x += 0.08;
  const after = createZones(moved.slice(0, 5), moved.slice(5));

  assert.deepEqual(after[0], before[0]);
  assert.notDeepEqual(after[1], before[1]);
  assert.notDeepEqual(after[2], before[2]);
  assert.deepEqual(after[3], before[3]);
});

test("screen position, not detector array order, decides left and right", () => {
  const frame = {
    hands: [hand("right-screen", 0.84), hand("left-screen", 0.16)],
    timestamp: 10,
    inferenceMs: 12,
  };
  const zones = frameToZones(frame);
  assert.equal(zones.length, 4);
  assert.ok(zones.every((zone) => zone.points[0].x < zone.points[1].x));
});

test("camera landmarks are mapped through the full-bleed cover crop", () => {
  const center = cameraPointToViewport({ x: 0.5, y: 0.5 }, 16 / 9, 1);
  const visibleLeft = cameraPointToViewport(
    { x: 0.21875, y: 0.5 },
    16 / 9,
    1,
  );
  const portraitTop = cameraPointToViewport(
    { x: 0.5, y: 0.21875 },
    9 / 16,
    1,
  );

  assert.deepEqual(center, { x: 0.5, y: 0.5 });
  assert.ok(Math.abs(visibleLeft.x) < 1e-10);
  assert.ok(Math.abs(portraitTop.y) < 1e-10);
});

test("tracking receives the same centered cover crop as the renderer", () => {
  assert.deepEqual(coverCrop(1920, 1080, 1), {
    x: 420,
    y: 0,
    width: 1080,
    height: 1080,
  });
  assert.deepEqual(coverCrop(1080, 1920, 1), {
    x: 0,
    y: 420,
    width: 1080,
    height: 1080,
  });
});

test("fingertip anchors extend along the final finger bone", () => {
  const projected = projectFingertip(
    { x: 0.5, y: 0.3 },
    { x: 0.5, y: 0.4 },
  );
  assert.equal(projected.x, 0.5);
  assert.ok(Math.abs(projected.y - 0.29) < 1e-10);
});

test("all 21 hand landmarks provide contextual fingertip anchors", () => {
  const landmarks = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.5,
  }));
  for (const [guide, parent, tip] of [
    [2, 3, 4],
    [6, 7, 8],
    [10, 11, 12],
    [14, 15, 16],
    [18, 19, 20],
  ]) {
    landmarks[guide] = { x: 0.5, y: 0.5 };
    landmarks[parent] = { x: 0.5, y: 0.4 };
    landmarks[tip] = { x: 0.5, y: 0.3 };
  }
  const tips = deriveFingertips(landmarks);

  assert.equal(tips.length, 5);
  assert.ok(tips.every((tip) => Math.abs(tip.y - 0.29) < 1e-10));
});

test("collapsed rails are rejected while folded bands remain trackable", () => {
  const collapsed = [
    { x: 0.5, y: 0.4 },
    { x: 0.51, y: 0.4 },
    { x: 0.51, y: 0.41 },
    { x: 0.5, y: 0.41 },
  ];
  assert.equal(isValidZone(collapsed), false);

  const folded = [
    { x: 0.2, y: 0.5 },
    { x: 0.8, y: 0.5 },
    { x: 0.8, y: 0.5 },
    { x: 0.2, y: 0.5 },
  ];
  assert.equal(isValidZone(folded), true);
});

test("nearby fingertips retain all four effect zones", () => {
  const left = Array.from({ length: 5 }, (_, finger) => ({
    x: 0.2 + finger * 0.0002,
    y: 0.48 + finger * 0.002,
  }));
  const right = Array.from({ length: 5 }, (_, finger) => ({
    x: 0.8 - finger * 0.0002,
    y: 0.48 + finger * 0.002,
  }));

  assert.equal(createZones(left, right).length, 4);
});

test("render interpolation moves zones smoothly toward fresh tracking", () => {
  const current = createZones(
    SYNTHETIC_TIPS.slice(0, 5),
    SYNTHETIC_TIPS.slice(5),
  );
  const shifted = SYNTHETIC_TIPS.map((point) => ({
    x: point.x + 0.1,
    y: point.y,
  }));
  const target = createZones(shifted.slice(0, 5), shifted.slice(5));
  const next = interpolateZones(current, target);

  assert.ok(next[0].points[0].x > current[0].points[0].x);
  assert.ok(next[0].points[0].x < target[0].points[0].x);
});

test("brief tracking gaps continue along measured fingertip motion", () => {
  const previous = createZones(
    SYNTHETIC_TIPS.slice(0, 5),
    SYNTHETIC_TIPS.slice(5),
  );
  const shifted = SYNTHETIC_TIPS.map((point) => ({
    x: point.x + 0.02,
    y: point.y,
  }));
  const next = createZones(shifted.slice(0, 5), shifted.slice(5));
  const velocities = zoneVelocities(previous, next, 40);
  const predicted = predictZones(next, velocities, 40);

  assert.ok(predicted[0].points[0].x > next[0].points[0].x);
  assert.equal(
    predictZones(next, velocities, 1000)[0].points[0].x,
    next[0].points[0].x + velocities[0].points[0].x * 180,
  );
});

test("quality selection protects small and lower-core devices", () => {
  const lite = selectQuality(390, 8);
  const balanced = selectQuality(900, 8);
  const high = selectQuality(1440, 12);
  assert.equal(lite.name, "lite");
  assert.equal(lite.detectionFps, 24);
  assert.equal(balanced.name, "balanced");
  assert.equal(balanced.detectionFps, 30);
  assert.equal(high.name, "high");
  assert.equal(high.detectionFps, 36);
});
