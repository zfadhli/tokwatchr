import pc from "picocolors";
import type {
	DownloadResult,
	DownloadStats,
	RemuxInfo,
	StreamInfo,
	WaitingInfo,
} from "../../index.js";
import { TikTokLiveDownloader, UserNotFoundError } from "../../index.js";
import type { WatchCliOptions } from "../types.js";
import { formatBytes, formatDuration, formatSpeed } from "../utils/format.js";

/**
 * Execute the `watch` command.
 *
 * Uses plain console output (no spinner) so terminal stays in cooked
 * mode and SIGINT flows normally through process.on().
 */
export async function executeWatch(
	username: string,
	options: WatchCliOptions,
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
		maxDuration: options.maxDuration ? options.maxDuration * 60 : undefined,
		maxSegmentDuration: (options.segmentDuration ?? 20) * 60,
		checkInterval: (options.interval ?? 3) * 60,
	});

	// ─── Wire events ───────────────────────────────────────

	// Suppress EventEmitter's default throw on "error" events —
	// our try/catch handles errors already.
	downloader.on("error", () => {});

	downloader.on("start", (info: StreamInfo) => {
		console.log(`\n${pc.blue(`@${info.username}`)}`);
		console.log(`  ${pc.green("Recording...")}`);
	});

	// The waiting event fires each poll cycle with elapsed time
	downloader.on("waiting", (info: WaitingInfo) => {
		process.stderr.write(
			`\r  ${pc.dim(`Waiting... ${formatDuration(info.elapsed)}`)}  `,
		);
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

	downloader.on("segment", (result: DownloadResult, partNum: number) => {
		process.stderr.write("\n");
		console.log(
			`  ${pc.green("Segment")} ${partNum}: ${result.filePath}  ${pc.dim(`(${formatBytes(result.sizeBytes)}, ${formatDuration(result.duration)})`)}`,
		);
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

	// ─── Start (persistent loop) ────────────────────────────

	console.log(
		`${pc.dim("Waiting for ")}${pc.blue(username)}${pc.dim(" to go live...")}`,
	);

	while (true) {
		try {
			await downloader.start();
			// Stream ended — complete event already printed results.
			// Continue watching for the next one.
			console.log(`\n  ${pc.dim("Stream ended, watching for next...")}`);
		} catch (error) {
			if (error instanceof UserNotFoundError) {
				console.error(
					pc.red("[error]"),
					"User not found. Check the username and try again.",
				);
				process.exit(1);
			}
			// Transient error (timeout, network) during waiting phase — retry
			console.error(`\n  ${pc.yellow(`[warning] ${error}`)}`);
			await new Promise((r) => setTimeout(r, 10_000));
			console.log(`  ${pc.dim("Retrying...")}`);
		}
	}
}
