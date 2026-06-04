import type { PathLike } from "node:fs";
import { createWriteStream } from "node:fs";
import { Impit } from "impit";
import { AbortError, DownloadFailedError } from "../errors.js";
import type { DownloadStats, StreamQualityKey } from "../types.js";

export interface RawHttpDownloadOptions {
	url: string;
	outputPath: PathLike;
	quality: StreamQualityKey;
	signal?: AbortSignal;
	onProgress?: (stats: DownloadStats) => void;
	maxDuration?: number;
}

/**
 * Download a livestream via raw HTTP FLV streaming.
 *
 * Writes the incoming FLV data directly to disk without transcoding.
 * No ffmpeg required.
 */
export async function downloadRawHttp(
	options: RawHttpDownloadOptions,
): Promise<{
	sizeBytes: number;
	duration: number;
	format: "flv";
}> {
	const { url, outputPath, quality, signal, onProgress, maxDuration } = options;

	const impIt = new Impit({
		browser: "chrome",
	});

	const response = await impIt.fetch(url, {
		signal,
	});

	if (!response.ok) {
		throw new DownloadFailedError(
			`HTTP ${response.status}: ${response.statusText}`,
		);
	}

	const bodyReader = response.body?.getReader();
	if (!bodyReader) {
		throw new DownloadFailedError("No response body stream");
	}

	const fileStream = createWriteStream(outputPath);
	const startTime = Date.now();
	let downloadedBytes = 0;
	let lastProgressTime = startTime;
	let lastProgressBytes = 0;
	let aborted = false;

	// Narrowed const for use in closures
	const reader: ReadableStreamDefaultReader<Uint8Array> = bodyReader;

	return new Promise((resolve, reject) => {
		const abortHandler = () => {
			aborted = true;
			reader.cancel().catch(() => {});
			fileStream.close();
			reject(new AbortError());
		};

		signal?.addEventListener("abort", abortHandler, { once: true });

		// Duration limit timer
		let durationTimer: ReturnType<typeof setTimeout> | null = null;
		if (maxDuration && maxDuration > 0 && maxDuration < Infinity) {
			durationTimer = setTimeout(() => {
				aborted = true;
				reader.cancel().catch(() => {});
				fileStream.close();
				resolve({
					sizeBytes: downloadedBytes,
					duration: (Date.now() - startTime) / 1000,
					format: "flv",
				});
			}, maxDuration * 1000);
		}

		function pump(): void {
			reader
				.read()
				.then(({ done, value }) => {
					if (done || aborted) {
						fileStream.close();
						if (!aborted) {
							resolve({
								sizeBytes: downloadedBytes,
								duration: (Date.now() - startTime) / 1000,
								format: "flv",
							});
						}
						if (durationTimer) clearTimeout(durationTimer);
						signal?.removeEventListener("abort", abortHandler);
						return;
					}

					downloadedBytes += value.byteLength;
					fileStream.write(value);

					// Emit progress every ~second
					const now = Date.now();
					const elapsed = now - lastProgressTime;
					if (elapsed >= 1000) {
						const bytesSinceLast = downloadedBytes - lastProgressBytes;
						const speed = bytesSinceLast / (elapsed / 1000);
						lastProgressTime = now;
						lastProgressBytes = downloadedBytes;

						onProgress?.({
							downloadedBytes,
							downloadedMB: downloadedBytes / (1024 * 1024),
							duration: (now - startTime) / 1000,
							speed,
							speedMBps: speed / (1024 * 1024),
							quality,
							state: "recording",
						});
					}

					pump();
				})
				.catch((err) => {
					if (aborted) return;
					fileStream.close();
					if (durationTimer) clearTimeout(durationTimer);
					signal?.removeEventListener("abort", abortHandler);
					reject(
						err instanceof Error
							? new DownloadFailedError("Stream read error", err)
							: new DownloadFailedError("Stream read error"),
					);
				});
		}

		fileStream.on("error", (err) => {
			if (aborted) return;
			if (durationTimer) clearTimeout(durationTimer);
			signal?.removeEventListener("abort", abortHandler);
			reject(new DownloadFailedError("File write error", err));
		});

		pump();
	});
}
