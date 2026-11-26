"use strict";

const toggle = document.querySelector("#mirror");
const errorMessage = document.querySelector("#error");
let savedSetting = false;
let receivedChange = false;
let pendingSetting = null;

function updateSetting(value) {
  savedSetting = value === true;
  toggle.checked = savedSetting;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.mirrorOutgoingVideo) return;
  receivedChange = true;
  updateSetting(changes.mirrorOutgoingVideo.newValue);
});

chrome.storage.local.get("mirrorOutgoingVideo").then((settings) => {
  if (!receivedChange) updateSetting(settings.mirrorOutgoingVideo);
}).catch(() => showError("Couldn’t read your mirror setting."));

toggle.addEventListener("change", async () => {
  if (pendingSetting !== null) {
    toggle.checked = pendingSetting;
    return;
  }

  const nextSetting = toggle.checked;
  pendingSetting = nextSetting;
  showError("");
  try {
    await chrome.storage.local.set({ mirrorOutgoingVideo: nextSetting });
    updateSetting(nextSetting);
  } catch {
    updateSetting(savedSetting);
    showError("Couldn’t save your mirror setting. Try again.");
  } finally {
    pendingSetting = null;
  }
});

const panel = document.querySelector("main");
const camStatus = document.querySelector("#camera-status");
const captureButton = document.querySelector("#capture");
const snapButton = document.querySelector("#snap");
const swipeButton = document.querySelector("#swipe");
const fingerButton = document.querySelector("#finger");
const effectButtons = Array.from(document.querySelectorAll("[data-command]"));
const meetingTab = chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab?.id);
let commandRunning = false;
let refreshing = false;
let updateVersion = 0;

function showEffects(status = {}) {
  const { active, ready, countdown, vanished, swipe, finger, fingerPhase, twin, stamp } = status;
  const fingerArmed = finger === "ready" || finger === "loading";
  panel.classList.toggle("room-visible", Boolean(vanished));
  panel.classList.toggle("twin-active", Boolean(twin));
  for (const button of effectButtons) {
    const command = button.dataset.command;
    button.disabled = !active;
    if (command === "twin" || command === "swipe") {
      button.setAttribute("aria-pressed", String(Boolean(command === "twin" ? twin : swipe)));
    }
    if (command === "confetti" || command === "approved") button.disabled = !active || Boolean(vanished);
    if (command === "clear") button.disabled = !(twin || stamp || countdown || ready || vanished);
  }
  captureButton.disabled = (!active && !countdown) || Boolean(vanished);
  captureButton.textContent = countdown ? "Cancel capture" : "Capture room";
  snapButton.disabled = !vanished && !(active && ready && !countdown);
  snapButton.dataset.command = vanished ? "return" : "snap";
  snapButton.textContent = vanished ? "Return" : "Snap";
  swipeButton.disabled = !(active && ready && !countdown && !vanished);
  fingerButton.disabled = swipeButton.disabled;
  fingerButton.setAttribute("aria-pressed", String(fingerArmed));

  let message = "Turn on your camera in Meet or Teams to use effects.";
  if (vanished) message = "Showing the saved room.";
  else if (countdown) message = `Step out of frame. Capturing in ${countdown}…`;
  else if (!active && ready) message = "Room saved. Turn on your camera to use it.";
  else if (finger === "loading") message = "Starting hand tracking…";
  else if (finger === "ready" && ready) {
    if (fingerPhase === "primed") message = "Snap pose recognized. Snap your fingers.";
    else if (fingerPhase === "tracking") message = "Hand found. Press your thumb and middle finger together.";
    else message = "Looking for your hand. Hold it near the camera.";
  }
  else if (finger === "error" && ready) message = "Hand tracking unavailable. Try again or use Snap.";
  else if (swipe && ready) message = "Swipe quickly across the upper half of the frame.";
  else if (ready) message = "Room saved. Use Snap or arm a gesture.";
  else if (active) message = "Capture an empty room first. You’ll have 5 seconds to step out.";
  if (camStatus.textContent !== message) camStatus.textContent = message;
}

async function sendEffect(command) {
  try {
    const tabId = await meetingTab;
    if (tabId !== undefined) return await chrome.tabs.sendMessage(tabId, { type: "mirro:effect", command });
  } catch {
    // Chrome rejects the message when the current tab has no Mirro content script.
  }
}

async function refreshEffects() {
  if (commandRunning || refreshing) return;
  refreshing = true;
  const version = updateVersion;
  const status = await sendEffect("status");
  if (version === updateVersion) showEffects(status);
  refreshing = false;
}

for (const button of effectButtons) {
  button.addEventListener("click", async () => {
    if (commandRunning) return;
    commandRunning = true;
    updateVersion++;
    const status = await sendEffect(button.dataset.command);
    showEffects(status);
    commandRunning = false;
  });
}

refreshEffects();
setInterval(refreshEffects, 300);

const musicButton = document.querySelector("#open-music");
if (chrome.sidePanel?.open) {
  chrome.windows.getCurrent().then(({ id }) => {
    if (id === undefined) return;
    musicButton.disabled = false;
    musicButton.addEventListener("click", () => {
      chrome.sidePanel.open({ windowId: id }).then(() => window.close()).catch(() => {
        showError("Couldn’t open the music panel. Try again.");
      });
    });
  }).catch(() => showError("Couldn’t find this Chrome window."));
} else {
  musicButton.textContent = "Music panel requires Chrome 116";
}
