// Subtitle files: compiled caption items → SRT / WebVTT.
const pad = (n, w = 2) => String(n).padStart(w, "0");

export function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function toSrt(captions) {
  return captions.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

export function toVtt(captions) {
  return "WEBVTT\n\n" + captions.map((c) => `${srtTime(c.start).replace(",", ".")} --> ${srtTime(c.end).replace(",", ".")}\n${c.text}\n`).join("\n");
}
