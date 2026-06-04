<!-- prettier-ignore -->
<div align="center">

# tokwatchr

**Download TikTok livestreams — given a username, download the livestream.**

[![npm version](https://img.shields.io/npm/v/tokwatchr?style=flat-square)](https://www.npmjs.com/package/tokwatchr)
[![npm downloads](https://img.shields.io/npm/dm/tokwatchr?style=flat-square)](https://www.npmjs.com/package/tokwatchr)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js->=20-3c873a?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

[Install](#install) • [Quick start](#quick-start) • [API](#api) • [How it works](#how-it-works) • [Advanced usage](#advanced-usage)

</div>

A TypeScript library for downloading TikTok livestreams. Pass a username, it records the stream in crash-safe `.ts` segments, applies EBU R128 audio normalization, and remuxes to `.mp4`. Uses [impit](https://github.com/apify/impit) for browser TLS fingerprint emulation to bypass bot detection, and [ffmpeg](https://ffmpeg.org) for audio normalization and container remuxing.

> [!NOTE]
> This project is a reverse-engineering effort and is not affiliated with TikTok. Use at your own risk.

## Features

- **One-shot or event-driven** — use the `download()` function for simplicity, or `TikTokLiveDownloader` for full control with progress and segment events.
- **Browser TLS emulation** — uses `impit` with Chrome fingerprints to bypass TikTok's bot detection.
- **System ffmpeg** — auto-detects ffmpeg on PATH; falls back to raw FLV download if not found.
- **EBU R128 audio normalization** — two-pass loudnorm (equivalent to `ffmpeg-normalize --preset streaming-video`), always applied.
- **Crash-safe `.ts` intermediate** — saves stream as MPEG-TS first (playable at any cut point), then remuxes to `.mp4`.
- **Automatic quality selection** — picks the best available quality (1080p → 720p → 540p → 360p).
- **Segment mode** — split long streams into configurable parts (e.g. 20min each) for reliability.
- **Wait-for-live mode** — polls periodically and starts recording when the user goes live.
- **Graceful stop & abort** — stop cleanly (keeps partial file) or abort immediately with `AbortSignal` support.
- **Proxy & cookie support** — HTTP/SOCKS proxies and cookie jars for authenticated streams.
- **Standalone utilities** — use `resolveRoomId()`, `fetchStreamInfo()`, or `createClient()` independently.

## Install

```bash
npm install tokwatchr
# or
bun add tokwatchr
```

> [!TIP]
> **System requirements:** [ffmpeg](https://ffmpeg.org) must be installed on your system for audio normalization and `.mp4` output. Without it, the library falls back to raw FLV download. On macOS `brew install ffmpeg`, on Ubuntu `sudo apt install ffmpeg`.

## Quick start

### One-shot download

```ts
import { download } from "tokwatchr";

const result = await download("officialgeilegisela", {
  output: "./recordings",
});

console.log(`Saved to ${result.filePath}`);
// → ./recordings/officialgeilegisela=20260604_143022.mp4
```

### With progress events

```ts
import { TikTokLiveDownloader } from "tokwatchr";

const d = new TikTokLiveDownloader("tv_asahi_news", {
  output: "./vods",
  maxDuration: 7_200, // 2 hours
});

d.on("progress", (stats) => {
  console.log(
    `${stats.downloadedMB.toFixed(1)}MB @ ${stats.speedMBps.toFixed(1)}MB/s`,
  );
});

d.on("complete", (results) => {
  for (const r of results) {
    console.log(`Done: ${r.filePath} (${r.sizeMB.toFixed(1)}MB)`);
  }
});

d.on("error", (err) => {
  console.error("Recording failed:", err.message);
});

await d.start();
```

### Segmented recording (20min parts, non-blocking remux)

```ts
const d = new TikTokLiveDownloader("username", {
  output: "./recordings",
  maxSegmentDuration: 1200, // 20 minutes per segment
});

d.on("segment", (result, partNum) => {
  console.log(`Part ${partNum} done: ${result.filePath}`);
});

d.on("complete", (results) => {
  console.log(`All ${results.length} segments complete`);
});

await d.start();
```

## API

### `download(username, options?)`

Functional shorthand. Returns a `Promise<DownloadResult>` (last segment when segmented).

```ts
import { download } from "tokwatchr";

const result = await download("username", {
  output: "./vods",
  quality: "best",
  onProgress: (s) => console.log(s.downloadedMB),
});
```

### `new TikTokLiveDownloader(username, options?)`

Class-based API with events and lifecycle control.

```ts
import { TikTokLiveDownloader } from "tokwatchr";

const d = new TikTokLiveDownloader("username", {
  output: "./vods",
  quality: "hd1",
  format: "ts",  // keep as .ts (no remux)
  proxyUrl: "socks5://localhost:1080",
});
```

#### Events

| Event | Payload | Description |
|---|---|---|
| `start` | `StreamInfo` | Stream URL resolved, recording starting |
| `progress` | `DownloadStats` | Emitted every ~1s during recording |
| `segment` | `[result: DownloadResult, partNumber: number]` | A segment completed (only when `maxSegmentDuration` is set) |
| `complete` | `DownloadResult[]` | All segments done, remuxed files ready |
| `error` | `Error` | An error occurred |
| `stop` | — | Recording was stopped via `stop()` |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `start()` | `Promise<DownloadResult>` | Wait for live, then record |
| `startRecording()` | `Promise<DownloadResult>` | Record now (fails if not live) |
| `waitForLive()` | `Promise<StreamInfo>` | Just wait, don't record |
| `stop()` | `Promise<void>` | Graceful stop (remuxes pending segments) |
| `abort()` | `void` | Immediate abort |
| `state` | `DownloaderState` | `"idle"` \| `"waiting"` \| `"recording"` \| `"stopping"` \| `"done"` |

### Options

```ts
interface TikTokLiveDownloaderOptions {
  output?: string;             // Output directory (default: process.cwd())
  filename?: string;           // Template: {username}, {date}, {time}, {title}, {part}
  quality?: "best" | "worst"   // Quality preference (default: "best")
           | "fullhd1" | "hd1" | "sd2" | "sd1";
  format?: "mp4" | "mkv" | "ts" | "flv";  // Output container (default: "mp4")
  useFfmpeg?: boolean;         // Auto-detects system ffmpeg (default: true if found)
  ffmpegPath?: string;         // Custom ffmpeg binary path
  ffmpegArgs?: string[];       // Extra ffmpeg args (default: ["-c", "copy"])
  bitrate?: string;            // Re-encode bitrate (e.g. "1M")
  maxDuration?: number;        // Seconds before auto-stop (default: Infinity)
  maxSegmentDuration?: number; // Split into segments this many seconds long
  checkInterval?: number;      // Poll interval for wait-for-live (ms, default: 30_000)
  proxyUrl?: string;           // HTTP/SOCKS proxy URL
  cookieJar?: CookieJarLike;   // tough-cookie compatible jar
  browser?: Browser;           // impit browser preset (default: "chrome")
  timeout?: number;            // Request timeout ms (default: 30_000)
  headers?: Record<string, string>;  // Extra HTTP headers
  signal?: AbortSignal;        // External cancellation
  // Callbacks (functional shorthand):
  onStart?: (info: StreamInfo) => void;
  onProgress?: (stats: DownloadStats) => void;
  onError?: (err: Error) => void;
}
```

### Types

```ts
interface StreamInfo {
  roomId: string;
  username: string;
  title: string;
  qualities: QualityOption[];
  selectedQuality: QualityOption;
  streamUrl: string;
  viewerCount: number;
  startedAt: Date;
}

interface DownloadStats {
  downloadedBytes: number;
  downloadedMB: number;
  duration: number;        // seconds elapsed
  speed: number;           // bytes/sec
  speedMBps: number;
  quality: StreamQualityKey;
  state: DownloaderState;
}

interface DownloadResult {
  filePath: string;
  sizeBytes: number;
  sizeMB: number;
  duration: number;        // seconds of content
  username: string;
  roomId: string;
  quality: StreamQualityKey;
  format: OutputFormat;    // "mp4" | "mkv" | "ts" | "flv"
  startedAt: Date;
  endedAt: Date;
}
```

### Error classes

```ts
import {
  TikTokLiveError,        // Base error class
  UserOfflineError,       // User is not live
  RoomResolveError,       // Could not find room ID
  StreamFetchError,       // Could not get stream URL
  DownloadFailedError,    // Download failed mid-stream
  FfmpegError,            // ffmpeg subprocess error
  AbortError,             // Request was aborted
} from "tokwatchr";
```

## How it works

```
Username
  │
  ├─ GET @{user}/live              (HTML scrape for roomId)
  │    └─ fallback: /api-live/user/room/
  │
  ▼
Room ID
  │
  ├─ GET /webcast/room/info/       (fetch stream URLs + qualities)
  │
  ▼
FLV endpoint  ────►  1080p | 720p | 540p | 360p
  │
  ├─ With ffmpeg:
  │    ffmpeg -i <flv_url> -c copy segment.ts   (crash-safe TS)
  │      → measure loudness with loudnorm
  │      → remux with AAC encode + EBU R128 normalization
  │      → segment.mp4  (final output)
  │
  └─ Without ffmpeg:
       HTTP stream → file.flv
```

The download process:

1. **Room ID resolution** — scrapes the user's TikTok live page for the room ID embedded in `SIGI_STATE`. Falls back to the `api-live/user/room/` API endpoint.
2. **Stream URL fetch** — calls `webcast/room/info/` to get available stream qualities. Selects the best available (1080p → 720p → 540p → 360p).
3. **Download to `.ts`** — saves the raw stream as MPEG-TS, which is playable even if truncated mid-stream.
4. **Remux with normalization** — two-pass EBU R128 loudnorm to -14 LUFS (streaming standard), AAC encode at 128k, video copied without re-encode.
5. **Segment loop** — if `maxSegmentDuration` is set, the process repeats: download, remux, emit `segment`, check for live, next segment.

All HTTP requests use `impit` with Chrome TLS fingerprint emulation to bypass bot detection.

## Advanced usage

### Standalone utilities

```ts
import { resolveRoomId, fetchStreamInfo, createClient } from "tokwatchr";

const impit = createClient({ browser: "chrome" });

const roomId = await resolveRoomId("username", impit);
const info = await fetchStreamInfo(roomId, "username", impit, {
  quality: "best",
});

console.log(info.streamUrl); // FLV URL
```

### Custom filename template

```ts
import { renderFilename } from "tokwatchr";

const name = renderFilename("{username}={date}_{time}", {
  username: "testuser",
  title: "My Stream Title",
});
// → "testuser=20260604_143022"
```

### Segmented download with custom part template

```ts
const d = new TikTokLiveDownloader("username", {
  maxSegmentDuration: 600,  // 10 min segments
  filename: "{username}_{title}_part{part}",
});
// → "officialgeilegisela_Live_Stream_part1.mp4"
// → "officialgeilegisela_Live_Stream_part2.mp4"
```

### Using a proxy

```ts
const d = new TikTokLiveDownloader("username", {
  proxyUrl: "http://user:pass@proxy:8080",
  browser: "chrome",
});
```

### Authenticated streams (cookies)

```ts
import { CookieJar } from "tough-cookie";

const jar = new CookieJar();
await jar.setCookie("sessionid=abc123", "https://www.tiktok.com");

const d = new TikTokLiveDownloader("username", {
  cookieJar: jar,
});
```

### Abort via `AbortSignal`

```ts
const controller = new AbortController();

const d = new TikTokLiveDownloader("username", {
  signal: controller.signal,
});

setTimeout(() => controller.abort(), 10_000); // 10s timeout
await d.start().catch((err) => {
  if (err.name === "AbortError") {
    console.log("Timed out");
  }
});
```

### Using your own ffmpeg

```ts
const d = new TikTokLiveDownloader("username", {
  ffmpegPath: "/usr/local/bin/ffmpeg",
  ffmpegArgs: ["-c:v", "libx264", "-preset", "fast", "-c:a", "aac"],
  bitrate: "2M",
});
```
