export class TikTokLiveError extends Error {
	override name = "TikTokLiveError";
}

export class UserOfflineError extends TikTokLiveError {
	override name = "UserOfflineError";
	constructor(username: string) {
		super(`User "${username}" is not currently live`);
	}
}

export class UserNotFoundError extends TikTokLiveError {
	override name = "UserNotFoundError";
	constructor(username: string) {
		super(`User "${username}" does not exist on TikTok`);
	}
}

export class RoomResolveError extends TikTokLiveError {
	override name = "RoomResolveError";
	constructor(username: string, cause?: unknown) {
		super(
			`Failed to resolve room ID for "${username}"${cause ? `: ${cause}` : ""}`,
		);
	}
}

export class StreamFetchError extends TikTokLiveError {
	override name = "StreamFetchError";
	constructor(roomId: string, cause?: unknown) {
		super(
			`Failed to fetch stream URL for room ${roomId}${cause ? `: ${cause}` : ""}`,
		);
	}
}

export class DownloadFailedError extends TikTokLiveError {
	override name = "DownloadFailedError";
	constructor(message: string, cause?: unknown) {
		super(`${message}${cause ? `: ${cause}` : ""}`);
	}
}

export class FfmpegError extends TikTokLiveError {
	override name = "FfmpegError";
	constructor(message: string, exitCode?: number | null) {
		super(
			`FFmpeg error: ${message}${exitCode != null ? ` (exit code ${exitCode})` : ""}`,
		);
	}
}

export class AbortError extends TikTokLiveError {
	override name = "AbortError";
	constructor() {
		super("Download was aborted");
	}
}
