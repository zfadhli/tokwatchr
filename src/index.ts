// ─── Main class & functional API ──────────────────────────

export type { CreateClientOptions } from "./api/client.js";
export { createClient } from "./api/client.js";
export type { RoomResolveOptions } from "./api/room.js";
// ─── API utilities (mid-level) ────────────────────────────
export { resolveRoomId } from "./api/room.js";
export type { StreamInfoOptions } from "./api/stream.js";
export { fetchStreamInfo } from "./api/stream.js";
// ─── Error classes ────────────────────────────────────────
export {
	AbortError,
	DownloadFailedError,
	FfmpegError,
	RoomResolveError,
	StreamFetchError,
	TikTokLiveError,
	UserNotFoundError,
	UserOfflineError,
} from "./errors.js";
export type { DownloadFunctionOptions } from "./TikTokLiveDownloader.js";
export { download, TikTokLiveDownloader } from "./TikTokLiveDownloader.js";
// ─── Types ────────────────────────────────────────────────
export type {
	CookieJarLike,
	DownloaderState,
	DownloadResult,
	DownloadStats,
	OutputFormat,
	QualityOption,
	StreamInfo,
	StreamQualityKey,
	TikTokLiveDownloaderEvents,
	TikTokLiveDownloaderOptions,
	WaitingInfo,
} from "./types.js";

// ─── Quality utilities ────────────────────────────────────
export {
	buildQualityOption,
	parseQualities,
	selectQuality,
} from "./utils/quality.js";

// ─── Template ─────────────────────────────────────────────
export { renderFilename } from "./utils/template.js";
