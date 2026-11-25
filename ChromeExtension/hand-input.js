(() => {
  "use strict";

  function relative(point, origin) {
    return [point.x - origin.x, point.y - origin.y, point.z - origin.z];
  }

  const fingertipBones = [9, 13];
  const contactWindow = 245;

  function distance(a, b) {
    return Math.hypot(...relative(a, b));
  }

  function handPose({ label, points, screen, aspect }) {
    if (points.length !== 21 || screen.length !== 21) return null;
    const wrist = points[0];
    const thumb = points[4];
    const palmAxis = relative(points[9], wrist);
    const palmLength = Math.hypot(...palmAxis);
    const screenDistance = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
    const screenPalm = screenDistance(screen[9], screen[0]);
    if (palmLength < 0.025 || screenPalm < 0.029) return null;

    return {
      label,
      x: (screen[0].x + screen[9].x) * aspect / 2,
      y: (screen[0].y + screen[9].y) / 2,
      scale: screenPalm,
      fingers: fingertipBones.map((base) => {
        const tipIndex = base + 3;
        const tip = points[tipIndex];
        const toTip = relative(tip, wrist);
        const chord = distance(points[base], tip);
        const bones = distance(points[base], points[base + 1]) +
          distance(points[base + 1], points[base + 2]) + distance(points[base + 2], tip);
        return {
          gap: distance(tip, thumb) / palmLength,
          reach: toTip.reduce((sum, value, index) => sum + value * palmAxis[index], 0) / (palmLength * palmLength),
          screenGap: screenDistance(screen[tipIndex], screen[4]) / screenPalm,
          screenReach: screenDistance(screen[tipIndex], screen[0]) / screenPalm,
          straightness: bones > 0 ? chord / bones : 1,
          knuckleReach: chord / palmLength
        };
      })
    };
  }

  function matchScore(track, pose) {
    const scaleRatio = Math.max(track.scale, pose.scale) / Math.min(track.scale, pose.scale);
    const movement = Math.hypot(pose.x - track.x, pose.y - track.y) / Math.max(track.scale, pose.scale);
    if (scaleRatio > 1.85 || movement > 1.45) return Infinity;
    return movement + Math.abs(Math.log(scaleRatio)) + (track.label === pose.label ? 0 : 0.18);
  }

  function prepared(pose) {
    return pose.straightness >= 0.70 && (
      (pose.screenGap <= 0.26 && pose.gap <= 0.60) ||
      (pose.gap <= 0.26 && pose.screenGap < 0.39)
    );
  }

  function release(contact, pose, time) {
    const opening = (pose.gap >= 0.32 && pose.gap - contact.gap >= 0.13) ||
      (pose.screenGap >= 0.31 && pose.screenGap - contact.screenGap >= 0.13);
    if (opening) contact.openedAt ??= time;

    const inward = contact.reach - pose.reach;
    const screenInward = contact.screenReach - pose.screenReach;
    const fold = contact.straightness - pose.straightness;
    const intoPalm = contact.knuckleReach - pose.knuckleReach;
    const recentOpening = contact.openedAt !== undefined && time - contact.openedAt <= 130;
    const inwardFlick = inward >= 0.16 || screenInward >= 0.22;
    if (recentOpening && inwardFlick && (fold >= 0.065 || intoPalm >= 0.12 || inward >= 0.27)) return true;

    // The middle finger can already be back against the palm in the next webcam frame.
    return fold >= 0.115 && intoPalm >= 0.17 && pose.straightness <= 0.87 &&
      (inward >= 0.20 || screenInward >= 0.27);
  }

  class FingerSnapDetector {
    constructor() {
      this.reset();
    }

    reset() {
      this.tracks = [];
      this.phase = "searching";
    }

    update(hands, time) {
      const unmatched = this.tracks.filter((track) => time - track.time <= contactWindow);
      const tracked = [];
      this.phase = "searching";
      for (const hand of hands) {
        const pose = handPose(hand);
        if (!pose) continue;
        let bestScore = Infinity;
        let bestIndex = -1;
        for (const [index, track] of unmatched.entries()) {
          const score = matchScore(track, pose);
          if (score >= bestScore) continue;
          bestScore = score;
          bestIndex = index;
        }
        const previous = bestIndex === -1 ? null : unmatched.splice(bestIndex, 1)[0];
        const track = { ...pose, time, frames: (previous?.frames ?? 0) + 1, contacts: [] };
        if (this.phase !== "primed") this.phase = "tracking";
        for (const [index, finger] of pose.fingers.entries()) {
          const prior = previous?.contacts[index];
          const contact = prior && time - prior.time <= contactWindow ? prior : null;
          const primed = contact && (contact.samples >= 2 ||
            (contact.precise && track.frames >= 3 && time - contact.time <= 105));
          if (contact && hand.motion >= 0.035) contact.movedAt = time;
          // Landmark positions can jump on a still image as the model adjusts its crop.
          if (primed && time - contact.movedAt <= 110 && release(contact, finger, time)) {
            this.reset();
            return true;
          }
          if (prepared(finger) && contact?.openedAt === undefined) {
            const samples = (contact?.samples ?? 0) + 1;
            track.contacts[index] = {
              ...finger,
              time,
              samples,
              precise: finger.screenGap <= 0.16 && finger.gap <= 0.29
            };
            if (samples >= 2) this.phase = "primed";
          } else if (contact && (contact.openedAt === undefined || time - contact.openedAt <= 130)) {
            track.contacts[index] = contact;
            if (primed) this.phase = "primed";
          }
        }
        tracked.push(track);
      }
      this.tracks = [...tracked, ...unmatched].slice(0, 4);
      return false;
    }
  }

  class HandInput {
    constructor() {
      this.detector = new FingerSnapDetector();
      this.session = 0;
      this.enabled = false;
      this.busy = false;
      this.pending = null;
      this.phase = "searching";
      document.addEventListener("mirro:hand-off", () => this.stop());
      document.addEventListener("mirro:hand-frame", (event) => this.sample(event.detail));
    }

    stop() {
      this.session++;
      this.enabled = false;
      this.busy = false;
      this.pending = null;
      this.phase = "searching";
      this.detector.reset();
    }

    publish(status) {
      document.dispatchEvent(new CustomEvent("mirro:hand-status", { detail: status }));
    }

    async start() {
      this.stop();
      const session = this.session;
      try {
        const context = await chrome.runtime.sendMessage({ type: "mirro:hand:open" });
        if (session !== this.session) return;
        if (!context?.ok) throw new Error("Hand processor unavailable");
        const model = await chrome.runtime.sendMessage({ type: "mirro:hand:load" });
        if (session !== this.session) return;
        if (!model?.ok) throw new Error("Hand model unavailable");
        this.enabled = true;
        this.publish("ready");
      } catch (error) {
        if (session !== this.session) return;
        console.warn("Mirro could not start finger snap detection.", error);
        this.publish("error");
      }
    }

    sample(detail) {
      if (!this.enabled || typeof detail?.jpeg !== "string" ||
          detail.jpeg.length > 224000 || !detail.jpeg.startsWith("data:image/jpeg;base64,") ||
          !Number.isFinite(detail.time)) return;
      this.pending = detail;
      if (!this.busy) void this.processSamples();
    }

    async processSamples() {
      const session = this.session;
      this.busy = true;
      try {
        while (this.pending && session === this.session) {
          const { jpeg, time } = this.pending;
          this.pending = null;
          const result = await chrome.runtime.sendMessage({ type: "mirro:hand:sample", jpeg, time });
          if (session !== this.session) return;
          if (!result?.ok) throw new Error("Hand sample unavailable");
          if (this.detector.update(result.hands, time)) {
            document.dispatchEvent(new Event("mirro:hand-snap"));
          } else if (this.phase !== this.detector.phase) {
            this.phase = this.detector.phase;
            document.dispatchEvent(new CustomEvent("mirro:hand-phase", { detail: this.phase }));
          }
        }
      } catch (error) {
        if (session !== this.session) return;
        console.warn("Mirro could not read a hand sample.", error);
        this.stop();
        this.publish("error");
      } finally {
        if (session === this.session) this.busy = false;
      }
    }
  }

  window.MirroHandInput = HandInput;
})();
