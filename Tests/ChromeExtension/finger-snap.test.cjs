"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const fixture = require("./finger-snap-landmarks.json");

const inputScript = fs.readFileSync(path.join(__dirname, "../../ChromeExtension/hand-input.js"), "utf8");
const contentWorld = { window: {}, document: { addEventListener() {} } };
vm.runInNewContext(inputScript, contentWorld);

function detector() {
  return new contentWorld.window.MirroHandInput().detector;
}

// Landmark coordinates extracted from Mx. Granger's CC0 recording.
// https://commons.wikimedia.org/wiki/File:Snapping_fingers.ogv
function handAt(frame, label = "Left", motion = 0.15) {
  const sample = fixture[frame];
  const empty = () => Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const points = empty();
  const screen = empty();
  for (const [landmark, coordinate] of Object.entries(sample)) {
    const [x, y, z, imageX, imageY] = coordinate;
    points[landmark] = { x, y, z };
    screen[landmark] = { x: imageX, y: imageY };
  }
  return { label, points, screen, aspect: 4 / 3, motion };
}

test("keeps the snap pose when the model flips the handedness label", () => {
  const snap = detector();
  assert.equal(snap.update([handAt(3)], 100), false);
  assert.equal(snap.update([handAt(5)], 167), false);
  assert.equal(snap.phase, "primed");
  assert.equal(snap.update([handAt(7, "Right")], 233), true);
});

test("recognizes the landed finger when the release frames were dropped", () => {
  const snap = detector();
  assert.equal(snap.update([handAt(25)], 833), false);
  assert.equal(snap.update([handAt(27)], 900), false);
  assert.equal(snap.update([handAt(32)], 1067), true);
});

test("a held pinch and a thumb opening without an inward flick stay live", () => {
  const snap = detector();
  for (const time of [0, 45, 92, 135]) assert.equal(snap.update([handAt(5)], time), false);
  const opened = handAt(5);
  opened.points[4].x += 0.025;
  opened.screen[4].x += 0.075;
  assert.equal(snap.update([opened], 198), false);
  assert.equal(snap.update([opened], 252), false);
});

test("landmark jumps on a still image cannot trigger the effect", () => {
  const snap = detector();
  snap.update([handAt(3, "Left", 0)], 100);
  snap.update([handAt(5, "Left", 0)], 167);
  assert.equal(snap.update([handAt(7, "Left", 0)], 233), false);
});

test("also detects a ring finger snap with the middle finger clear of the thumb", () => {
  const ring = (frame) => {
    const hand = handAt(frame);
    hand.points.splice(13, 4, ...hand.points.slice(9, 13).map((point) => ({ ...point })));
    hand.screen.splice(13, 4, ...hand.screen.slice(9, 13).map((point) => ({ ...point })));
    hand.points[12].x += 0.12;
    hand.screen[12].x += 0.2;
    return hand;
  };
  const snap = detector();
  assert.equal(snap.update([ring(3)], 100), false);
  assert.equal(snap.update([ring(5)], 167), false);
  assert.equal(snap.update([ring(7)], 233), true);
});

test("a different hand or a stale snap pose cannot finish the gesture", () => {
  const snap = detector();
  snap.update([handAt(3)], 100);
  snap.update([handAt(5)], 167);
  const other = handAt(7, "Right");
  for (const point of other.screen) point.x += 0.55;
  assert.equal(snap.update([other], 233), false);
  assert.equal(snap.update([handAt(7)], 520), false);
});
