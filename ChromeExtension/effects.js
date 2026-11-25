(() => {
  "use strict";

  const roomCountdown = 5000;
  const dissolveDuration = 920;
  const stampDuration = 2200;
  const sampleWidth = 64;
  const sampleHeight = 40;
  const dustColors = ["#cca78a", "#e0cb9d", "#a28c78", "#efdfbc"];

  function motionCenter(previous, current) {
    let count = 0;
    let totalX = 0;
    let totalY = 0;
    // Keep the gesture in the upper half, above normal hands-at-desk motion.
    for (let y = 2; y < sampleHeight / 2; y++) {
      for (let x = 0; x < sampleWidth; x++) {
        const pixel = (y * sampleWidth + x) * 4;
        const difference = Math.abs(current[pixel] - previous[pixel]) +
          Math.abs(current[pixel + 1] - previous[pixel + 1]) +
          Math.abs(current[pixel + 2] - previous[pixel + 2]);
        if (difference < 68) continue;
        count++;
        totalX += x;
        totalY += y;
      }
    }
    if (count < 15 || count > 310) return null;
    return { x: totalX / count / sampleWidth, y: totalY / count / sampleHeight };
  }

  class SwipeDetector {
    reset() {
      this.previous = null;
      this.stroke = null;
      this.lastSample = -Infinity;
    }

    sample(readPixels, now) {
      if (now - this.lastSample < 62) return false;
      if (now - this.lastSample > 180) this.reset();
      this.lastSample = now;
      const current = readPixels();
      const point = this.previous && motionCenter(this.previous, current);
      this.previous = current;
      if (!point) return false;

      const last = this.stroke;
      if (!last || now - last.started > 710 || Math.abs(last.y - point.y) > 0.15) {
        this.stroke = { ...point, startX: point.x, started: now, steps: 0, direction: 0 };
        return false;
      }
      const step = point.x - last.x;
      if (Math.abs(step) < 0.027) return false;
      const direction = Math.sign(step);
      if ((last.direction && last.direction !== direction) || Math.abs(step) > 0.28) {
        this.stroke = { ...point, startX: point.x, started: now, steps: 0, direction: 0 };
        return false;
      }
      this.stroke = { ...last, x: point.x, direction, steps: last.steps + 1 };
      return this.stroke.steps >= 3 && Math.abs(point.x - last.startX) >= 0.29;
    }
  }

  function drawTwin(context, frame, width, height, mirrored) {
    const half = Math.floor(width / 2);
    const sideWidth = mirrored ? width - half : half;
    const sideX = mirrored ? half : 0;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(frame, sideX, 0, sideWidth, height, 0, 0, half, height);
    context.setTransform(-1, 0, 0, 1, width, 0);
    context.drawImage(frame, sideX, 0, sideWidth, height, 0, 0, width - half, height);
  }

  function drawStamp(context, stamp, now, width, height, reducedMotion) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    const elapsed = (now - stamp.time) / stampDuration;
    if (stamp.kind === "approved") {
      const size = Math.round(Math.min(width * 0.088, height * 0.14));
      context.save();
      context.translate(width * 0.5, height * 0.77);
      context.rotate(-0.14);
      context.font = `800 ${size}px system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const labelWidth = context.measureText("APPROVED").width + size * 0.75;
      context.fillStyle = "#172520";
      context.fillRect(-labelWidth / 2, -size * 0.7, labelWidth, size * 1.4);
      context.strokeStyle = "#e2ead2";
      context.lineWidth = Math.max(2, size * 0.045);
      context.strokeRect(-labelWidth / 2, -size * 0.7, labelWidth, size * 1.4);
      context.fillStyle = "#e2ead2";
      context.fillText("APPROVED", 0, 0);
      context.restore();
      return;
    }

    const phase = reducedMotion ? 0.35 : elapsed;
    const size = Math.max(3, Math.min(width, height) * 0.013);
    const colors = ["#f0d49b", "#b4d0a1", "#ebaa95", "#edf0d9"];
    context.globalAlpha = reducedMotion ? 1 : Math.min(1, (1 - elapsed) * 3);
    for (let i = 0; i < 38; i++) {
      const spread = ((i * 17) % 39) / 39;
      const x = spread * width + Math.sin(i * 2) * width * phase * 0.11;
      const y = height * (phase * 1.15 - (i % 9) * 0.057);
      context.fillStyle = colors[i % colors.length];
      context.fillRect(x, y, size * (i % 2 ? 0.6 : 1.45), size);
    }
    context.globalAlpha = 1;
  }

  class CameraEffects {
    constructor() {
      this.cameras = new Set();
      this.sampler = new OffscreenCanvas(sampleWidth, sampleHeight);
      this.sampleContext = this.sampler.getContext("2d", { alpha: false, willReadFrequently: true });
      this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      this.detector = new SwipeDetector();
      this.detector.reset();
      this.twin = false;
      this.swipe = false;
      this.capture = null;
      this.room = null;
      this.snap = null;
      this.stamp = null;
    }

    currentCamera(now) {
      let current;
      for (const camera of this.cameras) {
        if (!camera.source.enabled || camera.source.muted || now - camera.lastSeen > 1500) continue;
        if (!current || current.lastSeen < camera.lastSeen) current = camera;
      }
      return current;
    }

    control(command) {
      const now = performance.now();
      const camera = this.currentCamera(now);
      if (command === "clear") {
        this.twin = false;
        this.swipe = false;
        this.capture = null;
        this.room = null;
        this.snap = null;
        this.stamp = null;
        this.detector.reset();
      } else if (command === "return") {
        this.snap = null;
        this.detector.reset();
      } else if (command === "capture" && this.capture) {
        this.capture = null;
      } else if (camera) {
        const roomReady = this.room?.key === camera.key;
        if (command === "twin") this.twin = !this.twin;
        if (!this.snap && (command === "confetti" || command === "approved")) {
          this.stamp = { kind: command, time: now };
        }
        if (command === "capture" && !this.snap) {
          this.swipe = false;
          this.detector.reset();
          this.capture = { key: camera.key, time: now + roomCountdown };
        }
        if (command === "swipe" && roomReady && !this.snap) {
          this.swipe = !this.swipe;
          this.detector.reset();
        }
        if (command === "snap" && roomReady && !this.capture) this.beginSnap();
      }

      if (this.capture && now > this.capture.time + 1500) this.capture = null;
      return {
        active: Boolean(camera),
        ready: Boolean(this.room && (!camera || this.room.key === camera.key)),
        countdown: this.capture ? Math.max(1, Math.ceil((this.capture.time - now) / 1000)) : 0,
        vanished: Boolean(this.snap),
        swipe: this.swipe,
        twin: this.twin,
        stamp: Boolean(this.stamp && now - this.stamp.time < stampDuration)
      };
    }

    beginSnap() {
      if (this.snap) return;
      this.snap = { time: null, image: null, tiles: [] };
      this.stamp = null;
      this.swipe = false;
      this.detector.reset();
    }

    sample(image) {
      const { width, height } = this.sampler;
      this.sampleContext.drawImage(image, 0, 0, width, height);
      return this.sampleContext.getImageData(0, 0, width, height).data;
    }

    copyFrame(frame) {
      const copy = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
      copy.getContext("2d", { alpha: false }).drawImage(frame, 0, 0);
      return copy;
    }

    makeDust(frame, now) {
      this.snap.time = now;
      if (this.reducedMotion.matches) return;
      const foreground = this.sample(frame);
      const background = this.room.pixels;
      this.snap.image = this.copyFrame(frame);
      for (let y = 0; y < sampleHeight; y++) {
        for (let x = 0; x < sampleWidth; x++) {
          const index = (y * sampleWidth + x) * 4;
          const difference = Math.abs(foreground[index] - background[index]) +
            Math.abs(foreground[index + 1] - background[index + 1]) +
            Math.abs(foreground[index + 2] - background[index + 2]);
          if (difference < 62) continue;
          const seed = (x * 17 + y * 29) % 37;
          this.snap.tiles.push({ x, y, seed, liftOff: (x / sampleWidth) * 0.47 + (seed / 37) * 0.25 });
        }
      }
    }

    drawRoom(context, width, height, now) {
      context.drawImage(this.room.image, 0, 0, width, height);
      const snap = this.snap;
      if (!snap.image) return;
      const progress = (now - snap.time) / dissolveDuration;
      if (progress >= 1) {
        snap.image = null;
        snap.tiles = [];
        return;
      }
      const tileWidth = width / sampleWidth;
      const tileHeight = height / sampleHeight;
      const sourceWidth = snap.image.width / sampleWidth;
      const sourceHeight = snap.image.height / sampleHeight;
      for (const tile of snap.tiles) {
        const x = tile.x * tileWidth;
        const y = tile.y * tileHeight;
        const age = progress - tile.liftOff;
        if (age < 0) {
          context.drawImage(snap.image, tile.x * sourceWidth, tile.y * sourceHeight,
            sourceWidth, sourceHeight, x, y, tileWidth + 0.5, tileHeight + 0.5);
        } else if (age < 0.35 && tile.seed % 3 === 0) {
          context.globalAlpha = (1 - age / 0.35) * 0.85;
          context.fillStyle = dustColors[tile.seed % dustColors.length];
          const drift = age * width * (0.10 + tile.seed / 120);
          const size = Math.max(1.25, (1 - age * 2) * tileWidth * 0.43);
          context.fillRect(x + drift, y - age * height * 0.15, size * 1.15, size);
        }
      }
      context.globalAlpha = 1;
    }

    render(frame, camera, canvas, context, mirrored) {
      const now = performance.now();
      if (!camera.source.enabled || camera.source.muted) return null;
      camera.lastSeen = now;
      if (this.capture?.key === camera.key && now >= this.capture.time) {
        if (now <= this.capture.time + 1500) {
          const image = this.copyFrame(frame);
          this.room = { key: camera.key, image, pixels: this.sample(image) };
          this.detector.reset();
        }
        this.capture = null;
      }

      if (this.swipe && this.room?.key === camera.key && !this.capture &&
          this.detector.sample(() => this.sample(frame), now)) {
        this.beginSnap();
      }

      const hidden = Boolean(this.snap && this.room);
      if (hidden && this.snap.time === null) this.makeDust(frame, now);
      if (this.stamp && now - this.stamp.time >= stampDuration) this.stamp = null;
      if (!mirrored && !this.twin && !hidden && !this.stamp) return null;

      const { displayWidth: width, displayHeight: height, timestamp, duration } = frame;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.globalAlpha = 1;
      context.setTransform(mirrored ? -1 : 1, 0, 0, 1, mirrored ? width : 0, 0);
      if (hidden) this.drawRoom(context, width, height, now);
      else if (this.twin && width > 1) drawTwin(context, frame, width, height, mirrored);
      else context.drawImage(frame, 0, 0, width, height);
      if (this.stamp) drawStamp(context, this.stamp, now, width, height, this.reducedMotion.matches);
      return new VideoFrame(canvas, { timestamp, duration: duration ?? undefined, alpha: "discard" });
    }
  }

  window.MirroCameraEffects = CameraEffects;
})();
