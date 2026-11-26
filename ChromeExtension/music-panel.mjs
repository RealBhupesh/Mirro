const form = document.querySelector("#provider-form");
const input = document.querySelector("#provider-url");
const status = document.querySelector("#provider-status");
const player = document.querySelector("#player");
const frameSlot = document.querySelector("#player-frame");
const closePlayer = document.querySelector("#close-player");
const idle = status.textContent;
const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com"]);
const spotifyKinds = new Set(["track", "album", "playlist", "artist", "episode", "show"]);
const embedRuleId = 1;
let youtubeIdentity;
let request = 0;

function updateStatus(message, error = false) {
  status.textContent = message;
  status.toggleAttribute("data-error", error);
}

function startTime(value) {
  if (!value) return 0;
  if (/^\d{1,7}$/.test(value)) return Number(value);
  const match = value.match(/^(?:(\d{1,4})h)?(?:(\d{1,4})m)?(?:(\d{1,4})s)?$/i);
  if (!match) return 0;
  const [, hours = 0, minutes = 0, seconds = 0] = match;
  return hours * 3600 + minutes * 60 + Number(seconds);
}

function youtubeSource(url) {
  const [path, id] = url.pathname.split("/").slice(1);
  const video = url.hostname === "youtu.be" ? path
    : path === "watch" ? url.searchParams.get("v")
    : ["shorts", "live", "embed"].includes(path) ? id : null;
  const list = url.searchParams.get("list");
  const hasVideo = /^[a-zA-Z0-9_-]{11}$/.test(video ?? "");
  const hasList = /^[a-zA-Z0-9_-]{2,120}$/.test(list ?? "");
  if (!hasVideo && !(hasList && (path === "playlist" || id === "videoseries"))) {
    throw new Error("Paste a YouTube video or playlist link.");
  }
  const embed = new URL("https://www.youtube.com/embed/" + (hasVideo ? video : "videoseries"));
  if (hasList) {
    embed.searchParams.set("listType", "playlist");
    embed.searchParams.set("list", list);
  }
  const time = startTime(url.searchParams.get("t") ?? url.searchParams.get("start"));
  if (time) embed.searchParams.set("start", String(time));
  return { kind: "youtube", name: "YouTube", url: embed.href };
}

function spotifySource(kind, id) {
  if (!spotifyKinds.has(kind) || !/^[a-zA-Z0-9]{22}$/.test(id ?? "")) {
    throw new Error("Paste a Spotify track, album, playlist, artist, podcast, or episode link.");
  }
  return { kind: "spotify", name: "Spotify", url: "https://open.spotify.com/embed/" + kind + "/" + id };
}

function parseSource(value) {
  if (value.startsWith("spotify:")) {
    const [, kind, id, extra] = value.split(":");
    if (extra === undefined) return spotifySource(kind, id);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a full YouTube or Spotify link.");
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) {
    throw new Error("Paste a YouTube or Spotify link beginning with https://.");
  }
  if (youtubeHosts.has(url.hostname)) return youtubeSource(url);
  if (url.hostname === "open.spotify.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (/^intl-[a-z-]+$/.test(parts[0] ?? "")) parts.shift();
    if (parts[0] === "embed") parts.shift();
    if (parts.length === 2) return spotifySource(...parts);
  }
  if (["spotify.link", "spoti.fi"].includes(url.hostname)) {
    throw new Error("Use the full open.spotify.com link from Spotify’s Share menu.");
  }
  throw new Error("Paste a supported YouTube or Spotify link.");
}

async function identifyToYouTube() {
  // Chrome omits Referer from extension pages. YouTube accepts the installed
  // app name and ID as HTTPS identification for a locally embedded client.
  const identity = "https://mirro." + chrome.runtime.id + "/";
  youtubeIdentity ??= chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [embedRuleId],
    addRules: [{
      id: embedRuleId,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "Referer", operation: "set", value: identity }]
      },
      condition: {
        urlFilter: "|https://www.youtube.com/embed/",
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ["sub_frame"]
      }
    }]
  });
  try {
    await youtubeIdentity;
  } catch {
    youtubeIdentity = undefined;
    throw new Error("Couldn’t initialize YouTube. Check Mirro’s YouTube site access in Chrome.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const version = ++request;
  input.removeAttribute("aria-invalid");
  let source;
  try {
    source = parseSource(input.value.trim());
  } catch (error) {
    input.setAttribute("aria-invalid", "true");
    updateStatus(error.message, true);
    input.focus();
    return;
  }
  try {
    if (source.kind === "youtube") await identifyToYouTube();
    if (version !== request) return;
    const frame = document.createElement("iframe");
    frame.className = source.kind;
    frame.title = source.name + " player";
    frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    if (source.kind === "spotify") frame.allow += "; clipboard-write";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.src = source.url;
    frameSlot.replaceChildren(frame);
    player.hidden = false;
    updateStatus(source.kind === "spotify"
      ? "Press Play in Spotify. Some tracks are available as previews only."
      : "Press Play in YouTube. Availability depends on the video’s embed settings.");
  } catch (error) {
    if (version !== request) return;
    updateStatus(error.message, true);
  }
});

closePlayer.addEventListener("click", () => {
  request++;
  frameSlot.replaceChildren();
  player.hidden = true;
  updateStatus(idle);
  input.focus();
});
