import { spawn } from "node:child_process";
import { FfmpegError } from "../errors.js";
import type { DownloadStats, StreamQualityKey } from "../types.js";

export interface FfmpegDownloadOptions {
	ffmpegPath: string;
	url: string;
	outputPath: string;
	quality: StreamQualityKey;
	args?: string[];
	bitrate?: string | null;
	signal?: AbortSignal;
	onProgress?: (stats: DownloadStats) => void;
	maxDuration?: number;
	/**
	 * Startup timeout in seconds. If ffmpeg produces no stderr output within
	 * this window, it is killed and the promise rejects. Prevents
	 * indefinite hangs on bad/ stalled stream URLs.
	 * @default 30
	 */
	timeout?: number;
}

/**
 * Parse ffmpeg stderr for duration and time progress.
 *
 * ffmpeg outputs lines like:
 *   frame=  123 fps= 30 q=28.0 size=    1024kB time=00:01:23.45 ...
 */
function parseFfmpegProgress(
	line: string,
): { duration?: number; sizeBytes?: number } | null {
	const result: { duration?: number; sizeBytes?: number } = {};

	// Parse time=HH:MM:SS.MS
	const timeMatch = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
	if (timeMatch) {
		const hours = Number(timeMatch[1]);
		const minutes = Number(timeMatch[2]);
		const seconds = Number(timeMatch[3]);
		result.duration = hours * 3600 + minutes * 60 + seconds;
	}

	// Parse size=   1024kB
	const sizeMatch = line.match(/size=\s*(\d+)(\w+)B/);
	if (sizeMatch && sizeMatch.length >= 3) {
		const value = Number(sizeMatch[1]);
		// biome-ignore lint/style/noNonNullAssertion: length >= 3 guarantees index 2
		const unit = sizeMatch[2]!;
		if (unit === "k" || unit === "K") {
			result.sizeBytes = value * 1024;
		} else if (unit === "m" || unit === "M") {
			result.sizeBytes = value * 1024 * 1024;
		} else {
			result.sizeBytes = value;
		}
	}

	return result.sizeBytes !== undefined || result.duration !== undefined
		? result
		: null;
}

/**
 * Download a livestream via ffmpeg.
 *
 * Spawns ffmpeg as a subprocess, pipes the stream URL as input,
 * and writes the transcoded/remuxed output to the specified path.
 *
 * Advantages over raw HTTP:
 * - Proper container format (mp4/mkv)
 * - Stream copy (fast) or re-encode
 * - Better handling of stream interruptions
 */
export async function downloadWithFfmpeg(
	options: FfmpegDownloadOptions,
): Promise<{
	sizeBytes: number;
	duration: number;
	format: "mp4" | "mkv";
}> {
	const {
		ffmpegPath,
		url,
		outputPath,
		quality,
		args: extraArgs,
		bitrate,
		signal,
		onProgress,
		maxDuration,
		timeout = 30,
	} = options;

	const ffmpegArgs: string[] = [
		"-y", // overwrite output
		"-i",
		url, // input URL
	];

	if (maxDuration && maxDuration > 0 && maxDuration < Infinity) {
		ffmpegArgs.push("-t", String(maxDuration));
	}

	if (bitrate) {
		ffmpegArgs.push("-c:v", "libx264", "-b:v", bitrate, "-c:a", "copy");
	} else if (extraArgs && extraArgs.length > 0) {
		ffmpegArgs.push(...extraArgs);
	} else {
		ffmpegArgs.push("-c", "copy");
	}

	ffmpegArgs.push(outputPath);

	return new Promise((resolve, reject) => {
		const proc = spawn(ffmpegPath, ffmpegArgs, {
			stdio: ["ignore", "pipe", "pipe"],
			signal,
		});

		let stderrBuffer = "";
		let sizeBytes = 0;
		let duration = 0;

		// Startup timeout — if ffmpeg produces no stderr output within
		// `timeout` seconds, it likely stalled on a bad URL. Kill it so the
		// caller doesn't hang indefinitely.
		let firstDataTimer: ReturnType<typeof setTimeout> | null = setTimeout(
			() => {
				firstDataTimer = null;
				proc.kill("SIGTERM");
				reject(
					new FfmpegError(
						`ffmpeg produced no output within ${timeout}s — check the stream URL`,
					),
				);
			},
			timeout * 1_000,
		);

		// Parse stderr for progress
		proc.stderr?.on("data", (chunk: Buffer | string) => {
			// Clear first-data timer on first output — ffmpeg is working
			if (firstDataTimer) {
				clearTimeout(firstDataTimer);
				firstDataTimer = null;
			}
			const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
			stderrBuffer += text;

			const lines = text.split("\n");
			for (const line of lines) {
				const parsed = parseFfmpegProgress(line);
				if (parsed) {
					if (parsed.duration !== undefined) {
						duration = parsed.duration;
					}
					if (parsed.sizeBytes !== undefined) {
						sizeBytes = parsed.sizeBytes;
					}

					onProgress?.({
						downloadedBytes: sizeBytes,
						downloadedMB: sizeBytes / (1024 * 1024),
						duration,
						speed: duration > 0 ? sizeBytes / duration : 0,
						speedMBps: duration > 0 ? sizeBytes / duration / (1024 * 1024) : 0,
						quality,
						state: "recording",
					});
				}
			}
		});

		proc.on("error", (err) => {
			if (firstDataTimer) {
				clearTimeout(firstDataTimer);
				firstDataTimer = null;
			}
			// spawn's signal option emits AbortError when the signal
			// is already aborted at spawn time or fires mid-flight.
			// Resolve with partial data instead of rejecting — the
			// close handler will also fire and see signal?.aborted.
			if (err.name === "AbortError") {
				resolve({
					sizeBytes,
					duration,
					format: outputPath.endsWith(".mkv") ? "mkv" : "mp4",
				});
				return;
			}
			reject(new FfmpegError(err.message));
		});

		proc.on("close", (code) => {
			if (firstDataTimer) {
				clearTimeout(firstDataTimer);
				firstDataTimer = null;
			}

			// When the user aborted, resolve with whatever we got.
			// spawn's signal option sends SIGTERM, which tells ffmpeg
			// to flush its output and exit cleanly.
			// Use signal?.aborted directly instead of a listener flag
			// to avoid a race between listener registration order and
			// the async close event.
			if (signal?.aborted) {
				resolve({
					sizeBytes,
					duration,
					format: outputPath.endsWith(".mkv") ? "mkv" : "mp4",
				});
				return;
			}

			if (code === 0) {
				// Clean exit — check we actually got data
				if (sizeBytes > 0) {
					resolve({
						sizeBytes,
						duration,
						format: outputPath.endsWith(".mkv") ? "mkv" : "mp4",
					});
				} else {
					reject(
						new FfmpegError(
							extractFfmpegError(stderrBuffer) || "Stream was empty",
							code,
						),
					);
				}
			} else if (code === null) {
				// Process killed by signal (SIGTERM, SIGKILL, etc.)
				if (sizeBytes > 0) {
					resolve({
						sizeBytes,
						duration,
						format: outputPath.endsWith(".mkv") ? "mkv" : "mp4",
					});
				} else {
					reject(
						new FfmpegError(
							"Process was killed before any data was received",
							code,
						),
					);
				}
			} else if (code === 1 || code === 255) {
				// ffmpeg exit codes for interruption / end-of-stream
				if (sizeBytes > 0) {
					resolve({
						sizeBytes,
						duration,
						format: outputPath.endsWith(".mkv") ? "mkv" : "mp4",
					});
				} else {
					const errorMsg = extractFfmpegError(stderrBuffer);
					reject(
						new FfmpegError(
							errorMsg || `FFmpeg exited with code ${code} and no data`,
							code,
						),
					);
				}
			} else {
				// Extract error from stderr
				const errorMsg = extractFfmpegError(stderrBuffer);
				reject(new FfmpegError(errorMsg, code));
			}
		});
	});
}

/**
 * Extract a meaningful error message from ffmpeg stderr output.
 */
function extractFfmpegError(stderr: string): string {
	const lines = stderr.split("\n").filter((l) => l.trim().length > 0);
	const errorLines = lines.filter(
		(l) =>
			l.toLowerCase().includes("error") ||
			l.toLowerCase().includes("invalid") ||
			l.toLowerCase().includes("cannot"),
	);

	if (errorLines.length > 0) {
		// biome-ignore lint/style/noNonNullAssertion: length > 0 guarantees index 0
		return errorLines[0]!.trim();
	}

	// Return last meaningful line
	return lines[lines.length - 1]?.trim() ?? "Unknown ffmpeg error";
}
