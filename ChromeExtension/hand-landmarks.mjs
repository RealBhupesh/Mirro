import { HandLandmarker } from "./vendor/mediapipe/vision_bundle.mjs";

const asset = (name) => chrome.runtime.getURL("vendor/mediapipe/" + name);
const streams = new Map();
const modelLimit = 2;
const motionWidth = 112;
const motionHeight = 80;

class HandMotion {
  constructor() {
    this.context = new OffscreenCanvas(motionWidth, motionHeight).getContext("2d", { willReadFrequently: true });
    this.previous = null;
  }

  compare(image, hands) {
    this.context.drawImage(image, 0, 0, motionWidth, motionHeight);
    const rgba = this.context.getImageData(0, 0, motionWidth, motionHeight).data;
    const luma = new Uint8Array(motionWidth * motionHeight);
    for (let i = 0; i < luma.length; i++) {
      luma[i] = (rgba[4 * i] * 54 + rgba[4 * i + 1] * 183 + rgba[4 * i + 2] * 19) >> 8;
    }
    const previous = this.previous;
    this.previous = luma;
    if (!previous) return hands.map(() => 0);

    // Ignore camera exposure changes which affect the entire picture.
    let exposureChange = 0;
    for (let i = 0; i < luma.length; i += 16) exposureChange += luma[i] - previous[i];
    exposureChange /= luma.length / 16;
    return hands.map((points) => {
      const fingers = [4, 10, 12, 14, 16].map((index) => points[index]);
      const left = Math.max(0, Math.floor((Math.min(...fingers.map((p) => p.x)) - 0.045) * motionWidth));
      const right = Math.min(motionWidth, Math.ceil((Math.max(...fingers.map((p) => p.x)) + 0.045) * motionWidth));
      const top = Math.max(0, Math.floor((Math.min(...fingers.map((p) => p.y)) - 0.045) * motionHeight));
      const bottom = Math.min(motionHeight, Math.ceil((Math.max(...fingers.map((p) => p.y)) + 0.045) * motionHeight));
      const area = (right - left) * (bottom - top);
      if (right <= left || bottom <= top) return 0;
      let changed = 0;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const pixel = y * motionWidth + x;
          if (Math.abs(luma[pixel] - previous[pixel] - exposureChange) >= 13) changed++;
        }
      }
      return changed / area;
    });
  }
}

function getStream(key) {
  let stream = streams.get(key);
  if (!stream) {
    if (streams.size === modelLimit) {
      const oldest = streams.keys().next().value;
      const evicted = streams.get(oldest);
      streams.delete(oldest);
      evicted.model.then((model) => model.close(), () => {});
    }
    const model = HandLandmarker.createFromOptions({
      wasmLoaderPath: asset("vision_wasm_internal.js"),
      wasmBinaryPath: asset("vision_wasm_internal.wasm")
    }, {
      baseOptions: { modelAssetPath: asset("hand_landmarker.task"), delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.44,
      minHandPresenceConfidence: 0.44,
      minTrackingConfidence: 0.42
    }).catch((error) => {
      if (streams.get(key) === stream) streams.delete(key);
      throw error;
    });
    stream = { model, lastTimestamp: -1, motion: new HandMotion() };
  }
  // Each document needs its own tracking history, even if two tabs run at once.
  streams.delete(key);
  streams.set(key, stream);
  return stream;
}

async function getHands(key, jpeg, time) {
  if (typeof jpeg !== "string" || !jpeg.startsWith("data:image/jpeg;base64,") ||
      jpeg.length > 224000 || !Number.isFinite(time) || time < 0) {
    return [];
  }
  const stream = getStream(key);
  const model = await stream.model;
  const image = await createImageBitmap(await (await fetch(jpeg)).blob());
  try {
    if (streams.get(key) !== stream || time <= stream.lastTimestamp) return [];
    stream.lastTimestamp = time;
    const result = model.detectForVideo(image, time);
    const motion = stream.motion.compare(image, result.landmarks);
    return result.worldLandmarks.map((points, index) => ({
      label: result.handedness[index]?.[0]?.categoryName ?? String(index),
      points,
      screen: result.landmarks[index],
      aspect: image.width / image.height,
      motion: motion[index]
    }));
  } finally {
    image.close();
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.tab) return;
  const key = sender.documentId ?? `${sender.tab.id}:${sender.frameId}`;
  let work;
  if (message?.type === "mirro:hand:load") work = getStream(key).model.then(() => ({}));
  if (message?.type === "mirro:hand:sample") {
    work = getHands(key, message.jpeg, message.time).then((hands) => ({ hands }));
  }
  if (!work) return;
  work.then((result) => respond({ ok: true, ...result }), (error) => {
    console.warn("Mirro hand processing failed.", error);
    respond({ ok: false });
  });
  return true;
});
