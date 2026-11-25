"use strict";

const cameraDemo = document.querySelector(".camera-demo");
const demoStatus = document.querySelector("#demo-status");
const feedMode = document.querySelector("#feed-mode");
const modeButtons = Array.from(cameraDemo.querySelectorAll("button[data-mode]"));
const overlayButtons = cameraDemo.querySelectorAll("button[data-effect]");
const confetti = cameraDemo.querySelector(".confetti");
const stamp = cameraDemo.querySelector(".stamp");
const effects = {
  original: ["Original", "The outgoing sample matches the original."],
  mirror: ["Mirrored", "The outgoing sample is flipped horizontally."],
  twin: ["Twin Mode", "One half of the outgoing sample is duplicated and reflected."],
  snap: ["Saved room", "The outgoing sample now shows an empty room."]
};
const confettiColors = ["#dceba7", "#ffcf83", "#f89e88", "#e8f3dc"];
let overlayTimer;

function clearOverlay() {
  window.clearTimeout(overlayTimer);
  delete cameraDemo.dataset.effect;
  confetti.replaceChildren();
}

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    const [label, description] = effects[mode];
    clearOverlay();
    cameraDemo.dataset.mode = mode;
    feedMode.textContent = "· " + label;
    demoStatus.textContent = description;
    for (const modeButton of modeButtons) {
      modeButton.setAttribute("aria-pressed", String(modeButton === button));
    }
  });
}

function addConfetti() {
  const pieces = document.createDocumentFragment();
  for (let index = 0; index < 33; index += 1) {
    const piece = document.createElement("i");
    piece.style.setProperty("--x", (4 + (index * 17) % 92) + "%");
    piece.style.setProperty("--y", ((index * 19) % 80) + "%");
    piece.style.setProperty("--size", (5 + index % 5) + "px");
    piece.style.setProperty("--angle", ((index * 37) % 180) + "deg");
    piece.style.setProperty("--drift", (-24 + (index * 19) % 49) + "px");
    piece.style.setProperty("--color", confettiColors[index % confettiColors.length]);
    pieces.append(piece);
  }
  confetti.append(pieces);
}

for (const button of overlayButtons) {
  button.addEventListener("click", () => {
    const effect = button.dataset.effect;
    clearOverlay();

    if (effect === "confetti") {
      addConfetti();
      demoStatus.textContent = "Confetti plays on the outgoing sample.";
    } else {
      // Commit the reset so repeated clicks replay the stamp.
      void stamp.offsetWidth;
      demoStatus.textContent = "The outgoing sample shows the Approved stamp.";
    }

    cameraDemo.dataset.effect = effect;
    overlayTimer = window.setTimeout(() => {
      clearOverlay();
      demoStatus.textContent = effects[cameraDemo.dataset.mode][1];
    }, effect === "approved" ? 2200 : 1300);
  });
}

const copyButton = document.querySelector("#copy-url");
const copyStatus = document.querySelector("#copy-status");
const extensionsUrl = document.querySelector("#extensions-url");
let copyTimer;

async function copyAddress() {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(extensionsUrl.textContent);
      return true;
    } catch {
      // Use the local selection fallback if the clipboard is unavailable.
    }
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(extensionsUrl);
  selection.removeAllRanges();
  selection.addRange(range);
  try {
    const copied = document.execCommand("copy");
    if (copied) selection.removeAllRanges();
    return copied;
  } catch {
    return false;
  }
}

copyButton.addEventListener("click", async () => {
  const copied = await copyAddress();
  window.clearTimeout(copyTimer);
  copyButton.textContent = copied ? "Copied" : "Address selected";
  copyStatus.textContent = copied ? "Chrome Extensions address copied." : "The address is selected. Use your copy shortcut.";
  copyTimer = window.setTimeout(() => {
    copyButton.textContent = "Copy address";
    copyStatus.textContent = "";
  }, 2400);
});
