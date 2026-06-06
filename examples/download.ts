#!/usr/bin/env bun
/**
 * Download a TikTok livestream given a username.
 *
 * Usage:
 *   bun run examples/download.ts officialgeilegisela
 *   bun run examples/download.ts tv_asahi_news --max-duration 3600 --output ./vods
 *   bun run examples/download.ts username --segment-duration 600  (10min segments)
 */
import { parseArgs } from "node:util";
import {
	TikTokLiveDownloader,
	UserNotFoundError,
	UserOfflineError,
} from "../src/index.js";

const args = parseArgs({
	args: process.argv.slice(2),
	options: {
		"max-duration": { type: "string", short: "d" },
		"segment-duration": { type: "string", short: "s" },
		output: { type: "string", short: "o", default: "./recordings" },
		quality: { type: "string", short: "q", default: "best" },
		format: { type: "string", short: "f", default: "mp4" },
		proxy: { type: "string", short: "p" },
		help: { type: "boolean", short: "h" },
	},
	allowPositionals: true,
});

const username = args.positionals[0];

if (!username || args.values.help) {
	console.log(`
tokwatchr — Download a TikTok livestream

Usage:
  bun run examples/download.ts <username> [options]

Options:
  -o, --output <dir>         Output directory (default: ./recordings)
  -d, --max-duration <s>     Stop after this many seconds
  -s, --segment-duration <s> Split into segments of this many seconds (e.g. 1200 = 20min)
  -q, --quality <key>        Quality: best | worst | fullhd1 | hd1 | sd2 | sd1
  -f, --format <ext>         Output format: mp4 | mkv | ts | flv (default: mp4)
  -p, --proxy <url>          HTTP/SOCKS proxy URL
  -h, --help                 Show this help

Examples:
  bun run examples/download.ts officialgeilegisela
  bun run examples/download.ts tv_asahi_news -d 7200 -o ./vods
  bun run examples/download.ts username -s 1200
  bun run examples/download.ts username -p socks5://localhost:1080
`);
	process.exit(username ? 0 : 1);
}

const downloader = new TikTokLiveDownloader(username, {
	output: args.values.output,
	quality: args.values.quality as
		| "best"
		| "worst"
		| "fullhd1"
		| "hd1"
		| "sd2"
		| "sd1"
		| undefined,
	format: args.values.format as "mp4" | "mkv" | "ts" | "flv" | undefined,
	proxyUrl: args.values.proxy,
	maxDuration: args.values["max-duration"]
		? Number.parseInt(args.values["max-duration"], 10)
		: undefined,
	maxSegmentDuration: args.values["segment-duration"]
		? Number.parseInt(args.values["segment-duration"], 10)
		: undefined,
});

// ─── Wire up event handlers ──────────────────────────────

downloader.on("waiting", (info) => {
	const phase =
		info.phase === "room" ? "Looking for room" : "Waiting for stream to start";
	process.stdout.write(
		`\r  @${info.username}: ${phase}... ${info.elapsed.toFixed(0)}s`,
	);
});

downloader.on("start", (info) => {
	console.log("");
	console.log(`  Username:  ${info.username}`);
	console.log(`  Title:     ${info.title || "(no title)"}`);
	console.log(`  Quality:   ${info.selectedQuality.label}`);
	console.log(`  Viewers:   ${info.viewerCount}`);
	console.log(`  Room:      ${info.roomId}`);
	console.log("");
	console.log("Recording...");
});

downloader.on("progress", (stats) => {
	const elapsed = formatDuration(stats.duration);
	const speed = stats.speedMBps.toFixed(1);
	const mb = stats.downloadedMB.toFixed(1);
	process.stdout.write(`\r  ${mb}MB  ·  ${speed}MB/s  ·  ${elapsed}  `);
});

downloader.on("segment", (result, partNum) => {
	console.log("");
	console.log(`  Segment ${partNum} done: ${result.filePath}`);
	console.log(`    Size:     ${result.sizeMB.toFixed(1)}MB`);
	console.log(`    Duration: ${formatDuration(result.duration)}`);
	console.log("");
});

downloader.on("complete", (results) => {
	console.log("\n");
	if (results.length === 1) {
		const r = results[0];
		console.log("  Done!");
		console.log(`  File:      ${r.filePath}`);
		console.log(`  Size:      ${r.sizeMB.toFixed(1)}MB`);
		console.log(`  Duration:  ${formatDuration(r.duration)}`);
		console.log(`  Format:    ${r.format}`);
	} else {
		console.log(`  All ${results.length} segments complete!`);
		const totalMB = results.reduce((s, r) => s + r.sizeMB, 0);
		const totalDuration = results.reduce((s, r) => s + r.duration, 0);
		console.log(`  Total size: ${totalMB.toFixed(1)}MB`);
		console.log(`  Total duration: ${formatDuration(totalDuration)}`);
		for (const r of results) {
			console.log(`    ${r.filePath} (${r.sizeMB.toFixed(1)}MB)`);
		}
	}
	console.log("");
});

downloader.on("error", (err) => {
	if (err instanceof UserNotFoundError) {
		console.log(`\n  ${err.message}`);
		process.exit(1);
		return;
	}

	if (err instanceof UserOfflineError) {
		console.log(`\n  ${err.message}`);
		console.log("  Waiting for stream to start...\n");
		downloader
			.start()
			.then(() => {
				// The complete handler above will fire
			})
			.catch((e) => {
				console.error(`\n  Failed: ${e.message}`);
				process.exit(1);
			});
		return;
	}

	console.error(`\n  Error: ${err.message}`);
	process.exit(1);
});

// ─── Handle graceful shutdown ────────────────────────────

process.on("SIGINT", async () => {
	console.log("\n\n  Stopping...");
	await downloader.stop();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("\n\n  Stopping...");
	await downloader.stop();
	process.exit(0);
});

// ─── Start ───────────────────────────────────────────────

console.log(`\n  Starting download for @${username}...`);

await downloader.start();

// ─── Helpers ─────────────────────────────────────────────

function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);

	const parts: string[] = [];
	if (h > 0) parts.push(`${h}h`);
	if (m > 0) parts.push(`${m}m`);
	parts.push(`${s}s`);
	return parts.join(" ");
}
