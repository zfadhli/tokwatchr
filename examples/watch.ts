#!/usr/bin/env bun
/**
 * Watch multiple TikTok users and download their livestreams automatically.
 *
 * Usage:
 *   bun run examples/watch.ts user1 user2 user3
 *   bun run examples/watch.ts user1 user2 --output ./vods --segment-duration 1200
 */
import { parseArgs } from "node:util";
import {
	StreamFetchError,
	TikTokLiveDownloader,
	UserNotFoundError,
	UserOfflineError,
} from "../src/index.js";

const args = parseArgs({
	args: process.argv.slice(2),
	options: {
		output: { type: "string", short: "o", default: "./recordings" },
		"max-duration": { type: "string", short: "d" },
		"segment-duration": { type: "string", short: "s" },
		quality: { type: "string", short: "q", default: "best" },
		help: { type: "boolean", short: "h" },
	},
	allowPositionals: true,
});

const usernames = args.positionals;

if (usernames.length === 0 || args.values.help) {
	console.log(`
tokwatchr — Watch multiple TikTok users for livestreams

Usage:
  bun run examples/watch.ts <username> [<username> ...] [options]

Options:
  -o, --output <dir>         Output directory (default: ./recordings)
  -d, --max-duration <s>     Stop after this many seconds
  -s, --segment-duration <s> Split into segments (e.g. 1200 = 20min)
  -q, --quality <key>        Quality: best | worst | fullhd1 | hd1 | sd2 | sd1
  -h, --help                 Show this help

Examples:
  bun run examples/watch.ts officialgeilegisela tv_asahi_news
  bun run examples/watch.ts user1 user2 user3 -d 7200 -o ./vods
  bun run examples/watch.ts user1 -s 1200
`);
	process.exit(usernames.length === 0 ? 1 : 0);
}

console.log(`\n  Watching ${usernames.length} user(s) for livestreams...\n`);

const activeDownloads = new Set<string>();
const activeDownloaders = new Map<string, TikTokLiveDownloader>();

async function tryDownload(username: string) {
	if (activeDownloads.has(username)) return;

	try {
		activeDownloads.add(username);
		console.log(`  [${timestamp()}] @${username}: Checking...`);

		const d = new TikTokLiveDownloader(username, {
			output: args.values.output,
			quality: args.values.quality as
				| "best"
				| "worst"
				| "fullhd1"
				| "hd1"
				| "sd2"
				| "sd1"
				| undefined,
			maxDuration: args.values["max-duration"]
				? Number.parseInt(args.values["max-duration"], 10)
				: undefined,
			maxSegmentDuration: args.values["segment-duration"]
				? Number.parseInt(args.values["segment-duration"], 10)
				: undefined,
		});
		activeDownloaders.set(username, d);

		d.on("waiting", (info) => {
			const phase =
				info.phase === "room" ? "Looking for room" : "Waiting for stream";
			process.stdout.write(
				`\r  [${timestamp()}] @${username}: ${phase}... ${info.elapsed.toFixed(0)}s`,
			);
		});

		d.on("remux", (info) => {
			if (info.status === "started") {
				process.stdout.write(
					`\r  [${timestamp()}] @${username}: Remuxing ${info.filePath}...`,
				);
			} else if (info.status === "completed") {
				console.log(
					`\n  [${timestamp()}] @${username}: Remux done: ${info.outputPath}`,
				);
			} else {
				console.warn(
					`\n  [${timestamp()}] @${username}: Remux failed, keeping .ts: ${info.filePath}`,
				);
			}
		});

		d.on("start", (info) => {
			console.log(
				`  [${timestamp()}] @${username}: Live! "${info.title}" at ${info.selectedQuality.label}`,
			);
		});

		d.on("progress", (stats) => {
			const mb = stats.downloadedMB.toFixed(1);
			const speed = stats.speedMBps.toFixed(1);
			process.stdout.write(
				`\r  [${timestamp()}] @${username}: ${mb}MB · ${speed}MB/s · ${formatDuration(stats.duration)}  `,
			);
		});

		d.on("segment", (result, partNum) => {
			console.log(
				`\n  [${timestamp()}] @${username}: Part ${partNum} — ${result.filePath} (${result.sizeMB.toFixed(1)}MB)`,
			);
		});

		const results: Array<{
			filePath: string;
			sizeMB: number;
			duration: number;
		}> = [];
		d.on("segment", (result) => results.push(result));
		d.on("complete", (all) => results.push(...all));

		await d.startRecording();

		const totalMB = results.reduce((s, r) => s + r.sizeMB, 0);
		console.log(
			`  [${timestamp()}] @${username}: Done — ${results.length} segment(s), ${totalMB.toFixed(1)}MB total`,
		);
	} catch (err) {
		if (err instanceof UserNotFoundError) {
			console.log(
				`  [${timestamp()}] @${username}: User not found — will not retry`,
			);
			activeDownloads.delete(username);
			return; // No retry for non-existent users
		}

		if (err instanceof StreamFetchError) {
			console.log(
				`  [${timestamp()}] @${username}: Room found but stream not active, will retry later`,
			);
		} else if (err instanceof UserOfflineError) {
			console.log(`  [${timestamp()}] @${username}: Offline, will retry later`);
		} else {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`\n  [${timestamp()}] @${username}: Error — ${message}`);
		}
	} finally {
		activeDownloads.delete(username);
		activeDownloaders.delete(username);
	}

	setTimeout(() => tryDownload(username), 60_000);
}

for (const username of usernames) {
	tryDownload(username);
}

process.on("SIGINT", async () => {
	console.log("\n\n  Stopping watcher...");
	await Promise.all([...activeDownloaders.values()].map((d) => d.stop()));
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("\n  Stopping watcher...");
	await Promise.all([...activeDownloaders.values()].map((d) => d.stop()));
	process.exit(0);
});

// ─── Helpers ─────────────────────────────────────────────

function timestamp(): string {
	return new Date().toLocaleTimeString("en-US", { hour12: false });
}

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
