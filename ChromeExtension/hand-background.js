"use strict";

const handPage = "hand-landmarks.html";
let creatingDocument;

async function openHandProcessor() {
  const url = chrome.runtime.getURL(handPage);
  const existing = chrome.runtime.getContexts
    ? await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] })
    : (await clients.matchAll()).filter((client) => client.url === url);
  if (existing.length && !creatingDocument) return;
  if (!creatingDocument) {
    creatingDocument = chrome.offscreen.createDocument({
      url: handPage,
      reasons: ["BLOBS"],
      justification: "Decode small camera frame samples for local hand landmark detection."
    });
  }
  const pending = creatingDocument;
  try {
    await pending;
  } finally {
    if (creatingDocument === pending) creatingDocument = undefined;
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.tab || message?.type !== "mirro:hand:open") return;
  openHandProcessor().then(() => respond({ ok: true }), (error) => {
    console.warn("Mirro could not start hand processing.", error);
    respond({ ok: false });
  });
  return true;
});
