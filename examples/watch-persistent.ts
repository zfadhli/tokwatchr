#!/usr/bin/env bun
/**
 * Watch a single TikTok user persistently — uses start() to block
 * and wait for the stream with the waiting timer displayed.
 *
 * Unlike watch.ts which cycles through multiple users with quick
 * checks, this example focuses on one user and waits continuously,
 * showing "Looking for room..." or "Waiting for stream to start..."
 * with an elapsed timer.
 *
 * Usage:
 *   bun run examples/watch-persistent.ts officialgeilegisela
 *   bun run examples/watch-persistent.ts username -o ./vods --check-interval 60
 */
import { parseArgs } from "node:util";
import { TikTokLiveDownloader } from "../src/index.js";

const args = parseArgs({
	args: process.argv.slice(2),
	options: {
		output: { type: "string", short: "o", default: "./recordings" },
		quality: { type: "string", short: "q", default: "best" },
		format: { type: "string", short: "f", default: "mp4" },
		"check-interval": { type: "string" },
		help: { type: "boolean", short: "h" },
	},
	allowPositionals: true,
});

const username = args.positionals[0];

if (!username || args.values.help) {
	console.log(`
tokwatchr — Watch a single user persistently (blocks until live)

Usage:
  bun run examples/watch-persistent.ts <username> [options]

Options:
  -o, --output <dir>          Output directory (default: ./recordings)
  -q, --quality <key>         Quality: best | worst | fullhd1 | hd1 | sd2 | sd1
  -f, --format <ext>          Output format: mp4 | mkv | ts | flv (default: mp4)
  --check-interval <seconds>  Poll interval for wait-for-live (default: 180)
  -h, --help                  Show this help

Examples:
  bun run examples/watch-persistent.ts officialgeilegisela
  bun run examples/watch-persistent.ts username -o ./vods --check-interval 60
`);
	process.exit(username ? 0 : 1);
}

console.log(`\n  Watching @${username} for livestreams...\n`);

// ─── Process signals (registered once) ───────────────────

let activeDownloader: TikTokLiveDownloader | null = null;

process.on("SIGINT", async () => {
	console.log("\n\n  Stopping...");
	await activeDownloader?.stop();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("\n  Stopping...");
	await activeDownloader?.stop();
	process.exit(0);
});

// ─── Main loop ──────────────────────────────────────────

async function run() {
	while (true) {
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
			format: args.values.format as "mp4" | "mkv" | "ts" | "flv" | undefined,
			checkInterval: args.values["check-interval"]
				? Number.parseInt(args.values["check-interval"], 10)
				: undefined,
		});
		activeDownloader = d;

		d.on("waiting", (info) => {
			const phase =
				info.phase === "room"
					? "Looking for room"
					: "Waiting for stream to start";
			process.stdout.write(
				`\r  @${username}: ${phase}... ${info.elapsed.toFixed(0)}s`,
			);
		});

		d.on("remux", (info) => {
			if (info.status === "started") {
				process.stdout.write(`\r  @${username}: Remuxing ${info.filePath}...`);
			} else if (info.status === "completed") {
				console.log(`\n  @${username}: Remux done: ${info.outputPath}`);
			} else {
				console.warn(
					`\n  @${username}: Remux failed, keeping .ts: ${info.filePath}`,
				);
			}
		});

		d.on("start", (info) => {
			console.log(
				`\n  @${username}: Live! "${info.title}" at ${info.selectedQuality.label}`,
			);
			console.log("  Recording...\n");
		});

		d.on("progress", (stats) => {
			const mb = stats.downloadedMB.toFixed(1);
			const speed = stats.speedMBps.toFixed(1);
			process.stdout.write(
				`\r  ${mb}MB · ${speed}MB/s · ${formatDuration(stats.duration)}  `,
			);
		});

		d.on("segment", (result, partNum) => {
			console.log(
				`\n  Part ${partNum}: ${result.filePath} (${result.sizeMB.toFixed(1)}MB)`,
			);
		});

		d.on("complete", (results) => {
			console.log("\n");
			for (const r of results) {
				console.log(`  Done: ${r.filePath} (${r.sizeMB.toFixed(1)}MB)`);
			}
			console.log("");
		});

		d.on("error", (err) => {
			console.error(`\n  @${username}: ${err.message}`);
		});

		try {
			await d.start();
			console.log(`\n  @${username}: Stream ended.\n`);
		} catch {
			// start() only rejects on non-recoverable errors
			// (user not found, abort, etc.)
		}

		activeDownloader = null;
		console.log(`  @${username}: Waiting 30s before next check...\n`);
		await sleep(30_000);
	}
}

run().catch((err) => {
	console.error(`\n  Fatal: ${err.message}`);
	process.exit(1);
});

// ─── Helpers ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
