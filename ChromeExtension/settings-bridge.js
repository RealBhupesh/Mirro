(() => {
  "use strict";

  let mirrored = false;
  let receivedChange = false;
  const commands = new Set(["status", "twin", "confetti", "approved", "capture", "snap", "return", "swipe", "finger", "clear"]);
  const hands = new window.MirroHandInput();
  delete window.MirroHandInput;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "mirro:effect" || !commands.has(message.command)) return;
    let status;
    const receive = (event) => { status = event.detail; };
    document.addEventListener("mirro:effect-status", receive, { once: true });
    document.dispatchEvent(new CustomEvent("mirro:effect-command", { detail: message.command }));
    document.removeEventListener("mirro:effect-status", receive);
    if (message.command === "finger" && status?.finger === "loading") hands.start();
    if (status?.active || status?.ready || status?.vanished || status?.countdown || status?.twin) sendResponse(status);
  });

  function publishSetting() {
    document.dispatchEvent(new CustomEvent("mirro:mirror-setting", { detail: mirrored }));
  }

  document.addEventListener("mirro:request-setting", publishSetting);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.mirrorOutgoingVideo) return;
    receivedChange = true;
    mirrored = changes.mirrorOutgoingVideo.newValue === true;
    publishSetting();
  });

  chrome.storage.local.get("mirrorOutgoingVideo").then((settings) => {
    if (receivedChange) return;
    mirrored = settings.mirrorOutgoingVideo === true;
    publishSetting();
  }).catch((error) => console.warn("Mirro could not read its setting.", error));
})();
