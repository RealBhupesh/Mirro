"use strict";

const audio = document.querySelector("audio");
const deck = document.querySelector(".deck");
const trackTitle = document.querySelector("#current-track");
const status = document.querySelector("#music-status");
const playlist = document.querySelector("#playlist");
const files = document.querySelector("#music-files");
const streamForm = document.querySelector("#stream-form");
const streamUrl = document.querySelector("#stream-url");
const queue = [];
let current = null;

function selectTrack(track) {
  current?.playButton.removeAttribute("aria-current");
  current = track;
  trackTitle.textContent = track?.title ?? "Nothing queued";
  status.textContent = track ? "Ready to play." : "Add a file or stream to play.";
  deck.classList.remove("playing");
  audio.hidden = !track;

  if (track) {
    track.playButton.setAttribute("aria-current", "true");
    audio.preload = track.local ? "metadata" : "none";
    audio.src = track.url;
  } else {
    audio.removeAttribute("src");
  }
  audio.load();
}

function showPlaybackError() {
  deck.classList.remove("playing");
  status.textContent = current.local
    ? "Chrome couldn’t play this file. Try an MP3, M4A, or WAV file."
    : "Chrome couldn’t play this stream. Check that the HTTPS link leads directly to audio.";
}

async function playTrack(track) {
  if (current !== track) selectTrack(track);
  try {
    await audio.play();
  } catch (error) {
    if (current !== track || error.name === "AbortError") return;
    if (error.name === "NotAllowedError") {
      status.textContent = "Press Play to start this track.";
    } else {
      showPlaybackError();
    }
  }
}

function removeTrack(track) {
  const index = queue.indexOf(track);
  queue.splice(index, 1);
  const neighbor = queue[index] ?? queue[index - 1];
  if (current === track) selectTrack(neighbor ?? null);
  if (track.row.contains(document.activeElement)) (neighbor?.playButton ?? files).focus();
  track.row.remove();
  if (track.local) URL.revokeObjectURL(track.url);
}

function addTrack(title, url, local) {
  const row = document.createElement("li");
  const playButton = document.createElement("button");
  const removeButton = document.createElement("button");
  const track = { title, url, local, row, playButton };
  playButton.type = "button";
  playButton.className = "track";
  playButton.textContent = title;
  playButton.setAttribute("aria-label", `Play ${title}`);
  playButton.addEventListener("click", () => playTrack(track));
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.setAttribute("aria-label", `Remove ${title}`);
  removeButton.addEventListener("click", () => removeTrack(track));
  row.append(playButton, removeButton);
  playlist.append(row);
  queue.push(track);
  if (!current) selectTrack(track);
}

files.addEventListener("change", () => {
  for (const file of files.files) addTrack(file.name, URL.createObjectURL(file), true);
  files.value = "";
});

streamUrl.addEventListener("input", () => streamUrl.setCustomValidity(""));
streamForm.addEventListener("submit", (event) => {
  event.preventDefault();
  let url;
  try {
    url = new URL(streamUrl.value.trim());
  } catch {
    // The field reports malformed URLs below.
  }
  if (url?.protocol !== "https:" || url.username || url.password) {
    streamUrl.setCustomValidity("Enter a direct HTTPS audio URL without a username or password.");
    streamUrl.reportValidity();
    return;
  }
  addTrack(`Stream from ${url.hostname}`, url.href, false);
  streamForm.reset();
  streamForm.closest("details").open = false;
  queue.at(-1).playButton.focus();
});

audio.addEventListener("playing", () => {
  deck.classList.add("playing");
  status.textContent = "";
});

for (const event of ["pause", "waiting"]) {
  audio.addEventListener(event, () => deck.classList.remove("playing"));
}

audio.addEventListener("error", () => {
  if (current && audio.error) showPlaybackError();
});

audio.addEventListener("ended", () => {
  deck.classList.remove("playing");
  if (!current) return;
  const next = queue[queue.indexOf(current) + 1];
  if (next) playTrack(next);
  else status.textContent = "End of queue.";
});
