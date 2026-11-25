(() => {
  "use strict";

  const devices = navigator.mediaDevices;
  const CameraEffects = window.MirroCameraEffects;
  delete window.MirroCameraEffects;
  if (!devices?.getUserMedia || !window.MediaStreamTrackProcessor ||
      !window.MediaStreamTrackGenerator || !window.OffscreenCanvas || !window.VideoFrame || !CameraEffects) {
    return;
  }

  const effects = new CameraEffects();
  document.addEventListener("mirro:effect-command", (event) => {
    const status = effects.control(event.detail);
    document.dispatchEvent(new CustomEvent("mirro:effect-status", { detail: status }));
  });

  let mirrored = false;
  document.addEventListener("mirro:mirror-setting", (event) => {
    mirrored = event.detail === true;
  });
  document.dispatchEvent(new Event("mirro:request-setting"));

  const { getUserMedia } = devices;
  const { clone, stop } = MediaStreamTrack.prototype;
  const enabled = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, "enabled");

  function processCamera(source) {
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return source;

    const processor = new MediaStreamTrackProcessor({ track: source, maxBufferSize: 1 });
    const output = new MediaStreamTrackGenerator({ kind: "video" });
    const abort = new AbortController();
    const outputs = new Set();
    const camera = { source, key: source.getSettings().deviceId || source.id, lastSeen: -Infinity };
    let closed = false;

    function syncEnabled() {
      source.enabled = Array.from(outputs).some((track) => enabled.get.call(track));
    }

    function forwardMute(event) {
      for (const track of outputs) track.dispatchEvent(new Event(event.type));
    }

    function release() {
      if (closed) return;
      closed = true;
      abort.abort();
      effects.cameras.delete(camera);
      source.removeEventListener("ended", release);
      source.removeEventListener("mute", forwardMute);
      source.removeEventListener("unmute", forwardMute);
      source.stop();
      for (const track of outputs) {
        const wasLive = track.readyState === "live";
        stop.call(track);
        if (wasLive) track.dispatchEvent(new Event("ended"));
      }
      outputs.clear();
    }

    function exposeCameraControls(track) {
      if (track.readyState === "ended") return track;
      outputs.add(track);
      Object.defineProperties(track, {
        label: { configurable: true, get: () => source.label },
        muted: { configurable: true, get: () => source.muted },
        enabled: {
          ...enabled,
          set(value) {
            enabled.set.call(track, value);
            if (outputs.has(track)) syncEnabled();
          }
        },
        getCapabilities: { value: source.getCapabilities.bind(source), configurable: true },
        getConstraints: { value: source.getConstraints.bind(source), configurable: true },
        getSettings: { value: source.getSettings.bind(source), configurable: true },
        applyConstraints: { value: source.applyConstraints.bind(source), configurable: true },
        clone: {
          configurable: true,
          value() {
            return exposeCameraControls(clone.call(track));
          }
        },
        stop: {
          configurable: true,
          value() {
            stop.call(track);
            if (!outputs.delete(track)) return;
            if (outputs.size === 0) release();
            else syncEnabled();
          }
        }
      });
      return track;
    }

    const transform = new TransformStream({
      transform(frame, controller) {
        let outputFrame;
        try {
          outputFrame = effects.render(frame, camera, canvas, context, mirrored);
        } catch {
          // Hold the last frame on a render failure while the room effect is active.
          if (effects.snap) {
            frame.close();
            return;
          }
        }
        if (outputFrame) frame.close();
        controller.enqueue(outputFrame || frame);
      }
    });

    exposeCameraControls(output);
    effects.cameras.add(camera);
    source.addEventListener("ended", release);
    source.addEventListener("mute", forwardMute);
    source.addEventListener("unmute", forwardMute);
    processor.readable.pipeThrough(transform).pipeTo(output.writable, { signal: abort.signal }).then(
      release,
      (error) => {
        if (closed) return;
        console.warn("Mirro camera processing stopped.", error);
        release();
      }
    );
    return output;
  }

  Object.defineProperty(devices, "getUserMedia", {
    writable: true,
    configurable: true,
    value: async function getMirroUserMedia(...args) {
      const stream = await getUserMedia.apply(this, args);
      for (const source of stream.getVideoTracks()) {
        let output;
        try {
          output = processCamera(source);
        } catch (error) {
          console.warn("Mirro could not process the camera. Using the original feed.", error);
          continue;
        }
        if (output === source) continue;
        stream.removeTrack(source);
        stream.addTrack(output);
      }
      return stream;
    }
  });
})();
