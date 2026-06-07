import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Impit } from "impit";
import { createClient } from "./api/client.js";
import { resolveRoomId } from "./api/room.js";
import { checkRoomAlive, fetchStreamInfo } from "./api/stream.js";
import { downloadWithFfmpeg } from "./download/ffmpeg.js";
import { downloadRawHttp } from "./download/raw-http.js";
import {
	StreamFetchError,
	UserNotFoundError,
	UserOfflineError,
} from "./errors.js";
import type {
	DownloaderState,
	DownloadResult,
	DownloadStats,
	ResolvedOptions,
	StreamInfo,
	TikTokLiveDownloaderEvents,
	TikTokLiveDownloaderOptions,
} from "./types.js";
import { renderFilename } from "./utils/template.js";

const DEFAULT_OPTIONS: ResolvedOptions = {
	output: ".",
	filename: "{username}={date}_{time}",
	quality: "best",
	format: "mp4",
	useFfmpeg: false,
	ffmpegPath: null,
	ffmpegArgs: [],
	bitrate: null,
	maxDuration: Infinity,
	maxSegmentDuration: Infinity,
	checkInterval: 180,
	proxyUrl: null,
	cookieJar: null,
	browser: "chrome",
	timeout: 30,
	headers: {},
	onProgress: null,
	onStart: null,
	onError: null,
	signal: null,
};

/**
 * Main class for downloading TikTok livestreams.
 *
 * Usage:
 * ```ts
 * const d = new TikTokLiveDownloader('username')
 * d.on('progress', s => console.log(`${s.downloadedMB}MB`))
 * const result = await d.start()
 * ```
 */
export class TikTokLiveDownloader {
	private readonly username: string;
	private readonly options: ResolvedOptions;
	private readonly emitter: EventEmitter;
	private readonly impIt: Impit;

	private _state: DownloaderState = "idle";
	private abortController: AbortController;
	private _userVerified = false;
	private _lastRoomId: string | null = null;
	private _stats: DownloadStats | null = null;
	private _result: DownloadResult | null = null;

	constructor(username: string, opts: TikTokLiveDownloaderOptions = {}) {
		this.username = username.replace(/^@/, "").trim();
		this.emitter = new EventEmitter();
		this.abortController = new AbortController();
		this.options = this.resolveOptions(opts);
		this.impIt = createClient({
			browser: this.options.browser,
			proxyUrl: this.options.proxyUrl,
			timeout: this.options.timeout * 1_000,
			headers: this.options.headers,
			cookieJar: this.options.cookieJar,
		});

		// Wire external AbortSignal into our internal one
		if (this.options.signal) {
			this.options.signal.addEventListener(
				"abort",
				() => this.abortController.abort(),
				{ once: true },
			);
		}
	}

	// ─── Public event API ──────────────────────────────────

	on<E extends keyof TikTokLiveDownloaderEvents>(
		event: E,
		listener: (...args: TikTokLiveDownloaderEvents[E]) => void,
	): this {
		this.emitter.on(event, listener as (...args: unknown[]) => void);
		return this;
	}

	once<E extends keyof TikTokLiveDownloaderEvents>(
		event: E,
		listener: (...args: TikTokLiveDownloaderEvents[E]) => void,
	): this {
		this.emitter.once(event, listener as (...args: unknown[]) => void);
		return this;
	}

	off<E extends keyof TikTokLiveDownloaderEvents>(
		event: E,
		listener: (...args: TikTokLiveDownloaderEvents[E]) => void,
	): this {
		this.emitter.off(event, listener as (...args: unknown[]) => void);
		return this;
	}

	private emit<E extends keyof TikTokLiveDownloaderEvents>(
		event: E,
		...args: TikTokLiveDownloaderEvents[E]
	): void {
		this.emitter.emit(event, ...args);
	}

	// ─── State accessors ───────────────────────────────────

	get state(): DownloaderState {
		return this._state;
	}

	get stats(): DownloadStats | null {
		return this._stats;
	}

	get result(): DownloadResult | null {
		return this._result;
	}

	// ─── Lifecycle ─────────────────────────────────────────

	/**
	 * Start recording. If the user is not currently live, polls
	 * until they go live and then starts recording.
	 *
	 * Resolves when the stream ends or maxDuration is reached.
	 */
	async start(): Promise<DownloadResult> {
		return this._run(true);
	}

	/**
	 * Start recording immediately. Throws if the user is not live.
	 */
	async startRecording(): Promise<DownloadResult> {
		return this._run(false);
	}

	/**
	 * Wait until the user goes live (does not record).
	 */
	async waitForLive(): Promise<StreamInfo> {
		this.setState("waiting");
		const roomId = await this.resolveRoomIdWithRetry();
		const info = await this.fetchStreamInfo(roomId);
		this.setState("idle");
		return info;
	}

	/**
	 * Gracefully stop the recording.
	 */
	async stop(): Promise<void> {
		if (this._state !== "recording" && this._state !== "waiting") {
			return;
		}
		this.setState("stopping");
		this.abortController.abort();
		// Wait for _run()'s catch block to finish remux and set "done"
		await new Promise<void>((resolve) => {
			const check = () => {
				if (this._state === "done") {
					resolve();
				} else {
					setTimeout(check, 100);
				}
			};
			check();
		});
	}

	/**
	 * Immediately abort the recording.
	 */
	abort(): void {
		this.abortController.abort();
	}

	// ─── Internal ─────────────────────────────────────────

	private setState(state: DownloaderState): void {
		this._state = state;
	}

	private resolveOptions(opts: TikTokLiveDownloaderOptions): ResolvedOptions {
		const resolved: ResolvedOptions = {
			...DEFAULT_OPTIONS,
			...Object.fromEntries(
				Object.entries(opts).filter(([, v]) => v !== undefined),
			),
		};

		// Auto-detect ffmpeg when not explicitly configured
		if (opts.useFfmpeg === undefined && opts.ffmpegPath === undefined) {
			const systemPath = detectSystemFfmpeg();
			if (systemPath) {
				resolved.useFfmpeg = true;
				resolved.ffmpegPath = systemPath;
			} else {
				resolved.useFfmpeg = false;
			}
		} else if (opts.useFfmpeg !== false) {
			resolved.useFfmpeg = true;
			resolved.ffmpegPath = opts.ffmpegPath ?? "ffmpeg";
		}

		// Determine output format
		if (resolved.format === "mp4" || resolved.format === "mkv") {
			if (!resolved.useFfmpeg) {
				resolved.format = "flv";
			}
		}

		return resolved;
	}

	private async _run(waitForLive: boolean): Promise<DownloadResult> {
		// Reset state so start() can be called multiple times
		this.abortController = new AbortController();
		this._userVerified = false;
		this._lastRoomId = null;
		if (this.options.signal) {
			this.options.signal.addEventListener(
				"abort",
				() => this.abortController.abort(),
				{ once: true },
			);
		}

		// Track background remuxes so we can await them on error/abort
		const pendingRemuxes: Promise<DownloadResult>[] = [];

		try {
			// Phase 1: Resolve room
			this.setState("waiting");
			let roomId = await this.resolveRoomIdOnce();

			// If offline and waitForLive, poll
			if (!roomId && waitForLive) {
				roomId = await this.resolveRoomIdWithRetry();
			}

			if (!roomId) {
				throw new UserOfflineError(this.username);
			}

			// Phase 2: Get stream info (refreshed per segment to avoid stale URLs)
			this.setState("waiting");
			const firstInfo = waitForLive
				? await this.pollStreamInfo(roomId)
				: await this.fetchStreamInfo(roomId);

			const segmentEnabled =
				this.options.maxSegmentDuration > 0 &&
				this.options.maxSegmentDuration < Infinity;

			if (!segmentEnabled) {
				// Single segment — download .ts then remux
				const tsResult = await this.downloadSegment(firstInfo, 1);
				const finalResult = await this.remuxSegment(tsResult);
				this._result = finalResult;
				this.setState("done");
				this.emit("complete", [finalResult]);
				return finalResult;
			}

			// Phase 3: Segmented download loop (non-blocking remux)
			let info = firstInfo;
			let partNum = 1;

			while (true) {
				this.abortController.signal?.throwIfAborted();

				this._state = "waiting";
				const tsResult = await this.downloadSegment(info, partNum);

				// Fire remux in background — doesn't block next segment
				const remuxPromise = this.remuxSegment(tsResult);
				pendingRemuxes.push(remuxPromise);

				this._result = tsResult;
				this.emit("segment", tsResult, partNum);

				partNum++;

				// Check if the stream is still live — refresh room info
				await sleep(1_000);
				try {
					const freshRoomId = await this.resolveRoomIdOnce();
					if (!freshRoomId) break;

					info = await this.fetchStreamInfo(freshRoomId);
				} catch {
					break;
				}
			}

			// All segments downloaded — wait for remuxes to finish
			const finalResults = await Promise.all(pendingRemuxes);
			this._result = finalResults[finalResults.length - 1] ?? null;
			this.setState("done");
			this.emit("complete", finalResults);
			// biome-ignore lint/style/noNonNullAssertion: at least one result
			return finalResults[finalResults.length - 1]!;
		} catch (err) {
			// One-shot waiting feedback for startRecording() users
			// when the stream isn't active yet.
			if (err instanceof StreamFetchError) {
				this.emit("waiting", {
					username: this.username,
					phase: "stream",
					elapsed: 0,
				});
			}

			// Await any background remuxes before shutting down,
			// so they can finish producing .mp4 and delete temp .ts files.
			if (pendingRemuxes.length > 0) {
				await Promise.allSettled(pendingRemuxes);
			}
			this.setState("done");
			const error = err instanceof Error ? err : new Error(String(err));
			this.emit("error", error);
			this.options.onError?.(error);
			throw error;
		}
	}

	private async resolveRoomIdOnce(): Promise<string | null> {
		// Fast path: if we already have a room ID, check_alive is lighter
		if (this._lastRoomId) {
			try {
				const alive = await checkRoomAlive(
					this._lastRoomId,
					this.impIt,
					this.abortController.signal,
				);
				if (alive) return this._lastRoomId;
			} catch {
				// fall through to normal resolution
			}
		}

		try {
			const roomId = await resolveRoomId(this.username, this.impIt, {
				signal: this.abortController.signal,
				skipUserCheck: this._userVerified,
			});
			if (roomId) {
				this._lastRoomId = roomId;
			}
			return roomId;
		} catch (error) {
			// User-not-found should fail fast, not retry
			if (error instanceof UserNotFoundError) {
				throw error;
			}

			// Check if the user is offline (room/info will tell us)
			try {
				// Try fetching room info directly to see if user is live
				const url = `https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=${encodeURIComponent(this.username)}&sourceType=54`;
				const resp = await this.impIt.fetch(url, {
					signal: this.abortController.signal,
				});
				if (resp.ok) {
					const data = (await resp.json()) as Record<string, unknown>;
					const dataObj = data.data as Record<string, unknown> | undefined;
					const user = dataObj?.user as Record<string, unknown> | undefined;
					const roomId = user?.roomId;
					if (roomId) return String(roomId);
				}
			} catch {
				// ignore
			}
			return null;
		}
	}

	private async resolveRoomIdWithRetry(): Promise<string> {
		const interval = this.options.checkInterval;
		const maxInterval = Math.max(interval, 180);
		const waitStart = Date.now();

		while (true) {
			this.abortController.signal?.throwIfAborted();

			const roomId = await this.resolveRoomIdOnce();
			if (roomId) {
				this._userVerified = true;
				this._lastRoomId = roomId;
				return roomId;
			}

			this.emit("waiting", {
				username: this.username,
				phase: "room",
				elapsed: (Date.now() - waitStart) / 1_000,
			});
			await sleep(maxInterval * 1_000);
		}
	}

	private async fetchStreamInfo(roomId: string): Promise<StreamInfo> {
		const info = await fetchStreamInfo(roomId, this.username, this.impIt, {
			quality: this.options.quality,
			signal: this.abortController.signal,
		});

		this.emit("start", info);
		this.options.onStart?.(info);

		return info;
	}

	/**
	 * Poll for stream info until the stream becomes active.
	 * Used in waitForLive mode when the room exists but the stream
	 * has not yet started broadcasting.
	 */
	private async pollStreamInfo(roomId: string): Promise<StreamInfo> {
		const interval = this.options.checkInterval;
		const maxInterval = Math.max(interval, 180);
		const waitStart = Date.now();

		while (true) {
			this.abortController.signal?.throwIfAborted();

			try {
				return await this.fetchStreamInfo(roomId);
			} catch (err) {
				if (err instanceof StreamFetchError) {
					this.emit("waiting", {
						username: this.username,
						phase: "stream",
						elapsed: (Date.now() - waitStart) / 1_000,
					});
					await sleep(maxInterval * 1_000);
					continue;
				}
				throw err;
			}
		}
	}

	/**
	 * Download a single segment. Always downloads to .ts (crash-safe).
	 * Does NOT remux — that is handled by remuxSegment() running in the background.
	 */
	private async downloadSegment(
		info: StreamInfo,
		partNumber?: number,
	): Promise<DownloadResult> {
		const startTime = new Date();
		const quality = info.selectedQuality;
		const segmentMaxDuration =
			this.options.maxSegmentDuration > 0 &&
			this.options.maxSegmentDuration < Infinity
				? this.options.maxSegmentDuration
				: this.options.maxDuration;

		const outputDir = this.options.output;
		if (!existsSync(outputDir)) {
			mkdirSync(outputDir, { recursive: true });
		}

		const fileBase = renderFilename(this.options.filename, {
			username: this.username,
			title: info.title,
			part: partNumber,
		});
		const fileName =
			partNumber && !this.options.filename.includes("{part}")
				? `${fileBase}_part${partNumber}`
				: fileBase;

		this.emit("progress", {
			downloadedBytes: 0,
			downloadedMB: 0,
			duration: 0,
			speed: 0,
			speedMBps: 0,
			quality: quality.key,
			state: "recording",
		});

		this.setState("recording");

		const onProgress = (stats: DownloadStats) => {
			this._stats = stats;
			this.emit("progress", stats);
			this.options.onProgress?.(stats);
		};

		if (this.options.useFfmpeg && this.options.ffmpegPath) {
			const tsPath = join(outputDir, `${fileName}.ts`);

			const result = await downloadWithFfmpeg({
				ffmpegPath: this.options.ffmpegPath,
				url: info.streamUrl,
				outputPath: tsPath,
				quality: quality.key,
				signal: this.abortController.signal,
				onProgress,
				maxDuration:
					segmentMaxDuration < Infinity ? segmentMaxDuration : undefined,
				timeout: this.options.timeout * 1_000,
			});

			return {
				filePath: tsPath,
				sizeBytes: result.sizeBytes,
				sizeMB: result.sizeBytes / (1024 * 1024),
				duration: result.duration,
				username: this.username,
				roomId: info.roomId,
				quality: quality.key,
				format: "ts" as const,
				startedAt: startTime,
				endedAt: new Date(),
			};
		}

		// Raw HTTP path — write directly to .flv
		const outputPath = join(outputDir, `${fileName}.flv`);
		const result = await downloadRawHttp({
			url: info.streamUrl,
			outputPath,
			quality: quality.key,
			signal: this.abortController.signal,
			onProgress,
			maxDuration:
				segmentMaxDuration < Infinity ? segmentMaxDuration : undefined,
		});

		return {
			filePath: outputPath,
			sizeBytes: result.sizeBytes,
			sizeMB: result.sizeBytes / (1024 * 1024),
			duration: result.duration,
			username: this.username,
			roomId: info.roomId,
			quality: quality.key,
			format: "flv" as const,
			startedAt: startTime,
			endedAt: new Date(),
		};
	}

	/**
	 * Remux a downloaded .ts segment to the target format with audio normalization.
	 * Runs in background, does not block the download loop.
	 *
	 * If remux fails, keeps the .ts as a playable fallback.
	 */
	private async remuxSegment(
		tsResult: DownloadResult,
	): Promise<DownloadResult> {
		// Can only remux ffmpeg-downloaded .ts files
		if (
			!this.options.useFfmpeg ||
			!this.options.ffmpegPath ||
			tsResult.format !== "ts"
		) {
			return tsResult;
		}

		const targetFormat = this.options.format;
		const inputPath = tsResult.filePath;

		// If target is .ts, nothing to do
		if (targetFormat === "ts") return tsResult;

		const finalExt = targetFormat === "mkv" ? "mkv" : "mp4";
		const finalPath = inputPath.replace(/\.ts$/, `.${finalExt}`);

		if (finalPath === inputPath) return tsResult;

		this.emit("remux", {
			filePath: inputPath,
			inputSizeMB: tsResult.sizeMB,
			status: "started",
		});

		try {
			await this.remuxAndNormalize(
				this.options.ffmpegPath,
				inputPath,
				finalPath,
			);
			// Remux succeeded — stat the real output size
			let realSizeBytes = tsResult.sizeBytes;
			try {
				const { statSync } = await import("node:fs");
				realSizeBytes = statSync(finalPath).size;
			} catch {
				// fall back to input size if stat fails
			}

			// Delete temp .ts
			try {
				const { unlinkSync } = await import("node:fs");
				unlinkSync(inputPath);
			} catch {
				// ignore cleanup failure
			}

			this.emit("remux", {
				filePath: inputPath,
				outputPath: finalPath,
				inputSizeMB: tsResult.sizeMB,
				outputSizeMB: realSizeBytes / (1024 * 1024),
				status: "completed",
			});

			return {
				...tsResult,
				filePath: finalPath,
				sizeBytes: realSizeBytes,
				sizeMB: realSizeBytes / (1024 * 1024),
				format: finalExt as "mp4" | "mkv",
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(
				`tokwatchr: remux failed for ${inputPath}, keeping .ts as fallback: ${msg}`,
			);

			this.emit("remux", {
				filePath: inputPath,
				inputSizeMB: tsResult.sizeMB,
				status: "failed",
			});

			return tsResult;
		}
	}

	/**
	 * Remux a .ts file to the target container with EBU R128 audio normalization.
	 *
	 * Two-pass loudnorm (equivalent to `ffmpeg-normalize --preset streaming-video -c:a aac`):
	 *   1. Measure integrated loudness, LRA, true peak
	 *   2. Apply linear normalization + encode AAC + copy video
	 *
	 * If the measurement pass fails (short file, edge case), falls back to
	 * plain AAC encode without loudnorm.
	 */
	private async remuxAndNormalize(
		ffmpegPath: string,
		inputPath: string,
		outputPath: string,
	): Promise<void> {
		const measured = await this.measureLoudness(ffmpegPath, inputPath);

		const args = ["-hide_banner", "-y", "-i", inputPath, "-c:v", "copy"];

		if (measured) {
			args.push(
				"-af",
				[
					"loudnorm=I=-14",
					"LRA=7",
					"TP=-2",
					"linear=true",
					`measured_I=${measured.inputI}`,
					`measured_LRA=${measured.inputLra}`,
					`measured_TP=${measured.inputTp}`,
					`measured_thresh=${measured.inputThresh}`,
					`offset=${measured.offset}`,
				].join(":"),
			);
		}

		args.push("-c:a", "aac", "-b:a", "128k");
		args.push(outputPath);

		return new Promise<void>((resolve, reject) => {
			const stderrChunks: Buffer[] = [];
			const proc = spawn(ffmpegPath, args, {
				stdio: ["ignore", "ignore", "pipe"],
				timeout: 600_000,
			});

			proc.stderr?.on("data", (chunk: Buffer) => {
				stderrChunks.push(chunk);
			});

			proc.on("error", (err) => reject(err));
			proc.on("close", (code) => {
				if (code === 0) {
					resolve();
				} else {
					const stderrOutput = Buffer.concat(stderrChunks).toString("utf-8");
					const tail =
						stderrOutput.length > 1500
							? `...${stderrOutput.slice(-1500)}`
							: stderrOutput;
					const msg = tail
						? `Remux exited with code ${code}: ${tail}`
						: `Remux exited with code ${code}`;
					reject(new Error(msg));
				}
			});
		});
	}

	/**
	 * Measure loudness of a .ts file using ffmpeg's loudnorm filter.
	 *
	 * Runs `loudnorm` with `print_format=json` and parses the JSON
	 * output from stderr. Returns the measured values for use in
	 * the second pass, or null if measurement failed.
	 */
	private async measureLoudness(
		ffmpegPath: string,
		inputPath: string,
	): Promise<{
		inputI: string;
		inputLra: string;
		inputTp: string;
		inputThresh: string;
		offset: string;
	} | null> {
		return new Promise((resolve, reject) => {
			const proc = spawn(
				ffmpegPath,
				[
					"-hide_banner",
					"-y",
					"-i",
					inputPath,
					"-af",
					"loudnorm=I=-14:LRA=7:TP=-2:print_format=json",
					"-f",
					"null",
					"-",
				],
				{
					stdio: ["ignore", "pipe", "pipe"],
					timeout: 300_000, // 5 min to measure a 20min segment
				},
			);

			let stderr = "";
			proc.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString("utf-8");
			});

			proc.on("error", (err) => reject(err));
			proc.on("close", (code) => {
				if (code !== 0) {
					resolve(null);
					return;
				}

				try {
					const parsed = parseLoudnormJson(stderr);
					resolve(parsed);
				} catch {
					resolve(null);
				}
			});
		});
	}
}

/**
 * Parse the JSON output from ffmpeg's loudnorm print_format=json.
 *
 * Handles two output styles:
 *   Multi-line:
 *     [Parsed_loudnorm_0 @ 0x...]
 *     { "input_i": "-23.5", ... }
 *   Single-line:
 *     [Parsed_loudnorm_0 @ 0x...] { "input_i": "-23.5", ... }
 */
function parseLoudnormJson(stderr: string): {
	inputI: string;
	inputLra: string;
	inputTp: string;
	inputThresh: string;
	offset: string;
} | null {
	try {
		// Find the first `{...}` JSON object in stderr using a simple depth counter
		let start = -1;
		let depth = 0;

		for (let i = 0; i < stderr.length; i++) {
			const ch = stderr[i];
			if (ch === "{") {
				if (start === -1) {
					start = i;
				}
				depth++;
			} else if (ch === "}") {
				depth--;
				if (depth === 0 && start !== -1) {
					const jsonStr = stderr.slice(start, i + 1);
					const data = JSON.parse(jsonStr);

					if (
						typeof data.input_i === "string" &&
						typeof data.input_lra === "string" &&
						typeof data.input_tp === "string" &&
						typeof data.input_thresh === "string" &&
						typeof data.target_offset === "string"
					) {
						return {
							inputI: data.input_i,
							inputLra: data.input_lra,
							inputTp: data.input_tp,
							inputThresh: data.input_thresh,
							offset: data.target_offset,
						};
					}
					return null;
				}
			}
		}
	} catch {
		// JSON parse failure
	}

	return null;
}

/**
 * Detect whether `ffmpeg` is available on the system PATH.
 *
 * Returns "ffmpeg" (or the resolved path) if found, or null if not.
 */
function detectSystemFfmpeg(): string | null {
	try {
		const result = spawnSync("ffmpeg", ["-version"], {
			stdio: "pipe",
			timeout: 5000,
		});
		return result.status === 0 ? "ffmpeg" : null;
	} catch {
		return null;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Functional API ──────────────────────────────────────

export interface DownloadFunctionOptions extends TikTokLiveDownloaderOptions {
	/** Override the target username (defaults to the one passed to download()). */
	username?: string;
}

/**
 * Download a TikTok livestream.
 *
 * Simplest one-shot API. Resolves when the stream ends.
 *
 * @param username - TikTok username (with or without @).
 * @param options - Download options and callbacks.
 */
export async function download(
	username: string,
	options: DownloadFunctionOptions = {},
): Promise<DownloadResult> {
	const downloader = new TikTokLiveDownloader(username, options);

	// Wire callbacks as events
	if (options.onStart) {
		downloader.on("start", options.onStart);
	}
	if (options.onProgress) {
		downloader.on("progress", options.onProgress);
	}
	if (options.onError) {
		downloader.on("error", options.onError);
	}

	return downloader.start();
}
