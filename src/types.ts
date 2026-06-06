import type { Browser } from "impit";

// ─── Quality ──────────────────────────────────────────────

export type StreamQualityKey = "fullhd1" | "hd1" | "sd2" | "sd1";

export interface QualityOption {
	key: StreamQualityKey;
	label: string;
	level: number;
	flv: string;
	hls: string;
}

// ─── Stream info ──────────────────────────────────────────

export interface StreamInfo {
	roomId: string;
	username: string;
	title: string;
	qualities: QualityOption[];
	selectedQuality: QualityOption;
	streamUrl: string;
	viewerCount: number;
	startedAt: Date;
}

// ─── Download stats (live) ────────────────────────────────

export interface DownloadStats {
	downloadedBytes: number;
	downloadedMB: number;
	duration: number; // seconds elapsed
	speed: number; // bytes/sec
	speedMBps: number;
	quality: StreamQualityKey;
	state: DownloaderState;
}

// ─── Download result ──────────────────────────────────────

export interface DownloadResult {
	filePath: string;
	sizeBytes: number;
	sizeMB: number;
	duration: number; // seconds of content
	username: string;
	roomId: string;
	quality: StreamQualityKey;
	format: OutputFormat;
	startedAt: Date;
	endedAt: Date;
}

// ─── States ───────────────────────────────────────────────

export type DownloaderState =
	| "idle"
	| "waiting"
	| "recording"
	| "stopping"
	| "done";
export type OutputFormat = "mp4" | "mkv" | "ts" | "flv";

// ─── Options ──────────────────────────────────────────────

export interface TikTokLiveDownloaderOptions {
	/** Output directory (default: process.cwd()) */
	output?: string;
	/** Filename template. Variables: {username}, {date}, {time}, {title} (default: "{username}={date}_{time}") */
	filename?: string;
	/** Quality preference (default: "best") */
	quality?: "best" | "worst" | StreamQualityKey;
	/** Output container format (default: "mp4" when ffmpeg available, "flv" otherwise) */
	format?: OutputFormat;
	/** Use ffmpeg for download + remux. Auto-detects system ffmpeg on PATH. */
	useFfmpeg?: boolean;
	/** Custom ffmpeg binary path. Overrides auto-detected system ffmpeg. */
	ffmpegPath?: string;
	/** Extra ffmpeg output arguments (default: ["-c", "copy"]). Set to override. */
	ffmpegArgs?: string[];
	/** Re-encode bitrate (e.g. "1M", "1000k"). Default: copy streams (no re-encode). */
	bitrate?: string;
	/** Max recording duration in seconds (default: Infinity). */
	maxDuration?: number;
	/** Split recording into segments of this many seconds (default: Infinity = single file). */
	maxSegmentDuration?: number;
	/** Polling interval in seconds when waiting for live (default: 180). */
	checkInterval?: number;
	/** HTTP proxy URL (supports http, https, socks4, socks5). */
	proxyUrl?: string;
	/** Tough-cookie compatible cookie jar for authenticated sessions. */
	cookieJar?: CookieJarLike;
	/** Browser to emulate (default: "chrome"). */
	browser?: Browser;
	/** Request timeout in seconds (default: 30). */
	timeout?: number;
	/** Extra headers to send with every request. */
	headers?: Record<string, string>;
	/** Progress callback (functional shorthand). */
	onProgress?: (stats: DownloadStats) => void;
	/** Start callback (functional shorthand). */
	onStart?: (info: StreamInfo) => void;
	/** Error callback (functional shorthand). */
	onError?: (err: Error) => void;
	/** AbortSignal for cancellation. */
	signal?: AbortSignal;
}

export interface CookieJarLike {
	setCookie(raw: string, url: string): Promise<void>;
	getCookieString(url: string): Promise<string>;
}

// ─── Events ───────────────────────────────────────────────

export interface WaitingInfo {
	/** The username being waited on. */
	username: string;
	/** Which phase we're waiting in: "room" = looking for a room, "stream" = stream not active. */
	phase: "room" | "stream";
	/** Seconds elapsed since this phase started. */
	elapsed: number;
}

export interface RemuxInfo {
	/** Input .ts file path. */
	filePath: string;
	/** Input file size in MB. */
	inputSizeMB: number;
	/** Remux status: started → completed (with outputPath) or failed (keeping .ts). */
	status: "started" | "completed" | "failed";
	/** Output file path. Only set when status is "completed". */
	outputPath?: string;
}

export interface TikTokLiveDownloaderEvents {
	/** Emitted periodically while waiting for a room or stream to become active. */
	waiting: [info: WaitingInfo];
	/** Emitted when a remux operation starts, completes, or fails. */
	remux: [info: RemuxInfo];
	/** Emitted when a live stream is detected and we're about to start recording. */
	start: [info: StreamInfo];
	/** Emitted periodically (every ~1s) during recording with current stats. */
	progress: [stats: DownloadStats];
	/** Emitted when each segment completes. Only fires when maxSegmentDuration is set. */
	segment: [result: DownloadResult, partNumber: number];
	/** Emitted when all segments are done and the stream has ended. */
	complete: [results: DownloadResult[]];
	/** Emitted on any error. The downloader will also throw. */
	error: [err: Error];
	/** Emitted when stop() is called and cleanup is done. */
	stop: [];
}

// ─── Internal resolved options ────────────────────────────

export interface ResolvedOptions {
	output: string;
	filename: string;
	quality: "best" | "worst" | StreamQualityKey;
	format: OutputFormat;
	useFfmpeg: boolean;
	ffmpegPath: string | null;
	ffmpegArgs: string[];
	bitrate: string | null;
	maxDuration: number;
	maxSegmentDuration: number;
	checkInterval: number;
	proxyUrl: string | null;
	cookieJar: CookieJarLike | null;
	browser: Browser;
	timeout: number;
	headers: Record<string, string>;
	onProgress: ((stats: DownloadStats) => void) | null;
	onStart: ((info: StreamInfo) => void) | null;
	onError: ((err: Error) => void) | null;
	signal: AbortSignal | null;
}
