#! /usr/bin/env node

import { cac } from "cac";
import { version } from "../../package.json";
import { executeDownload } from "./commands/download.js";
import { executeWatch } from "./commands/watch.js";
import type { DownloadCliOptions, WatchCliOptions } from "./types.js";
import { handleFatalError } from "./utils/errors.js";

// -------------------------------------------------------
// Program
// -------------------------------------------------------
const cli = cac("tokwatchr");

// -------------------------------------------------------
// download  —  one-shot fire-and-forget
// -------------------------------------------------------
cli
	.command(
		"download <username>",
		"Download a TikTok livestream (user must be live)",
	)
	.option("-o, --output <dir>", "Output directory [cwd]")
	.option(
		"-q, --quality <quality>",
		"Quality: best|worst|fullhd1|hd1|sd2|sd1 [best]",
	)
	.option("-f, --format <format>", "Format: mp4|mkv|ts|flv [mp4]")
	.option("--proxy <url>", "HTTP/SOCKS proxy URL")
	.option("--no-ffmpeg", "Skip ffmpeg processing (output .flv)")
	.example("tokwatchr download officialgeilegisela")
	.example("tokwatchr download tv_asahi_news -o ./vods -q hd1")
	.example("tokwatchr download username --proxy socks5://localhost:1080")
	.action(async (username: string, options: DownloadCliOptions) => {
		try {
			await executeDownload(username, options);
		} catch (error) {
			handleFatalError(error);
		}
	});

// -------------------------------------------------------
// watch  —  wait for live, then record with events
// -------------------------------------------------------
cli
	.command(
		"watch <username>",
		"Wait for a user to go live, then start recording",
	)
	.option("-o, --output <dir>", "Output directory [cwd]")
	.option(
		"-q, --quality <quality>",
		"Quality: best|worst|fullhd1|hd1|sd2|sd1 [best]",
	)
	.option("-f, --format <format>", "Format: mp4|mkv|ts|flv [mp4]")
	.option(
		"-d, --max-duration <minutes>",
		"Max recording duration in minutes [no limit]",
	)
	.option(
		"-s, --segment-duration <minutes>",
		"Split into N-minute segments [20]",
	)
	.option("-i, --interval <minutes>", "Poll interval in minutes [3]")
	.option("--proxy <url>", "HTTP/SOCKS proxy URL")
	.option("--no-ffmpeg", "Skip ffmpeg processing (output .flv)")
	.example("tokwatchr watch username")
	.example("tokwatchr watch username -s 10 -d 120")
	.example("tokwatchr watch username -i 1")
	.action(async (username: string, options: WatchCliOptions) => {
		try {
			await executeWatch(username, options);
		} catch (error) {
			handleFatalError(error);
		}
	});

// -------------------------------------------------------
// Parse
// -------------------------------------------------------
cli.help();
cli.version(version);
cli.parse();
