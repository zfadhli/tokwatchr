import pc from "picocolors";

/**
 * Base error for all CLI-level failures.
 * Separate from tokwatchr's own error classes.
 */
export class CliError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "CliError";
	}
}

/** User pressed Ctrl+C or cancelled a prompt */
export class UserCancelledError extends CliError {
	constructor() {
		super("Cancelled");
		this.name = "UserCancelledError";
	}
}

/** Invalid or missing configuration */
export class ConfigError extends CliError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ConfigError";
	}
}

/**
 * Render a caught error to stderr and exit with a non-zero code.
 * Tokwatchr errors are rendered with their own messages; unexpected
 * errors include the stack trace in debug mode.
 */
export function handleFatalError(error: unknown): never {
	if (error instanceof CliError) {
		console.error(pc.red("[error]"), error.message);
		process.exit(1);
	}

	// tokwatchr error classes
	if (error instanceof Error) {
		switch (error.name) {
			case "UserNotFoundError":
				console.error(
					pc.red("[error]"),
					"User not found. Check the username and try again.",
				);
				break;
			case "UserOfflineError":
				console.error(pc.red("[error]"), error.message);
				break;
			case "RoomResolveError":
				console.error(
					pc.red("[error]"),
					"Could not find the user's livestream room.",
				);
				break;
			case "StreamFetchError":
				console.error(
					pc.red("[error]"),
					"Could not fetch stream info. Check the username and try again.",
				);
				break;
			case "DownloadFailedError":
				console.error(pc.red("[error]"), `Download failed: ${error.message}`);
				break;
			case "FfmpegError":
				console.error(pc.red("[error]"), error.message);
				break;
			case "AbortError":
				console.error(pc.blue("[info]"), "Aborted.");
				break;
			default:
				console.error(pc.red("[error]"), `Unexpected error: ${error.message}`);
				if (process.env.DEBUG) {
					console.error(error.stack);
				}
				break;
		}
	} else {
		console.error(pc.red("[error]"), String(error));
	}

	process.exit(1);
}
