import pc from "picocolors";
import type {
	DownloadResult,
	DownloadStats,
	RemuxInfo,
	StreamInfo,
} from "../../index.js";
import {
	TikTokLiveDownloader,
	UserNotFoundError,
	UserOfflineError,
} from "../../index.js";
import type { DownloadCliOptions } from "../types.js";
import { formatBytes, formatDuration, formatSpeed } from "../utils/format.js";

/**
 * Execute the `download` command.
 *
 * Uses plain console output (no spinner) so terminal stays in cooked
 * mode and SIGINT flows normally through process.on().
 */
export async function executeDownload(
	username: string,
	options: DownloadCliOptions,
): Promise<void> {
	let downloader: TikTokLiveDownloader;

	// ─── SIGINT / SIGTERM (registered BEFORE any async work) ─────

	const onSignal = async () => {
		console.log(`\n\n  ${pc.red("Stopping...")}`);
		await downloader.stop();
		process.exit(0);
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	downloader = new TikTokLiveDownloader(username, {
		output: options.output,
		quality: options.quality,
		format: options.format,
		proxyUrl: options.proxy,
		useFfmpeg: options.ffmpeg,
	});

	console.log(`${pc.dim("Resolving room...")}`);

	// ─── Wire events ───────────────────────────────────────

	// Suppress EventEmitter's default throw on "error" events —
	// our try/catch handles errors already.
	downloader.on("error", () => {});

	downloader.on("start", (info: StreamInfo) => {
		console.log(`\n${pc.blue(`@${info.username}`)}`);
		console.log(`  ${pc.green("Recording...")}`);
	});

	downloader.on("progress", (stats: DownloadStats) => {
		const line = `${formatBytes(stats.downloadedBytes)} @ ${formatSpeed(stats.speed)}  [${formatDuration(stats.duration)}]`;
		process.stderr.write(`\r  ${line}  `);
	});

	downloader.on("remux", (info: RemuxInfo) => {
		switch (info.status) {
			case "started":
				process.stderr.write(`\n  ${pc.dim("Remuxing...")}`);
				break;
			case "completed":
				process.stderr.write(
					`\r  ${pc.green("Remuxed:")} ${info.outputPath}\n`,
				);
				break;
			case "failed":
				process.stderr.write(
					`\n  ${pc.yellow("Remux failed, keeping .ts as fallback")}\n`,
				);
				break;
		}
	});

	downloader.on("complete", (results: DownloadResult[]) => {
		process.stderr.write("\n");
		for (const r of results) {
			console.log(
				`  ${pc.green("Saved:")} ${r.filePath}  ${pc.dim(`(${formatBytes(r.sizeBytes)}, ${formatDuration(r.duration)})`)}`,
			);
		}
		const totalMB = results.reduce((sum, r) => sum + r.sizeMB, 0);
		console.log(
			`  Done — ${results.length} segment(s), ${totalMB.toFixed(1)}MB total`,
		);
	});

	// ─── Start ──────────────────────────────────────────────

	try {
		await downloader.startRecording();
	} catch (error) {
		if (error instanceof UserNotFoundError) {
			console.error(
				pc.red("[error]"),
				"User not found. Check the username and try again.",
			);
			process.exit(1);
		}
		if (error instanceof UserOfflineError) {
			console.error(pc.red("[error]"), error.message);
			process.exit(1);
		}
		console.error(pc.red("[error]"), String(error));
		throw error;
	}
}
