import type { QualityOption, StreamQualityKey } from "../types.js";

/**
 * Quality ladder sorted from highest to lowest.
 */
const QUALITY_ORDER: StreamQualityKey[] = ["fullhd1", "hd1", "sd2", "sd1"];

const QUALITY_LABELS: Record<StreamQualityKey, string> = {
	fullhd1: "1080p",
	hd1: "720p",
	sd2: "540p",
	sd1: "360p",
};

const QUALITY_LEVELS: Record<StreamQualityKey, number> = {
	fullhd1: 4,
	hd1: 3,
	sd2: 2,
	sd1: 1,
};

/**
 * Build a QualityOption from a raw url object.
 */
export function buildQualityOption(
	key: StreamQualityKey,
	flv: string,
	hls?: string,
): QualityOption {
	return {
		key,
		label: QUALITY_LABELS[key],
		level: QUALITY_LEVELS[key],
		flv,
		hls: hls ?? "",
	};
}

/**
 * Select a quality from available options.
 *
 * @param qualities - Available quality options to choose from.
 * @param preference - "best" (highest available), "worst" (lowest), or a specific key.
 * @returns The selected quality option.
 */
export function selectQuality(
	qualities: QualityOption[],
	preference: "best" | "worst" | StreamQualityKey,
): QualityOption {
	if (qualities.length === 0) {
		throw new Error("No stream qualities available");
	}

	if (preference === "best") {
		// biome-ignore lint/style/noNonNullAssertion: length checked above
		return qualities[0]!;
	}

	if (preference === "worst") {
		// biome-ignore lint/style/noNonNullAssertion: length checked above
		return qualities[qualities.length - 1]!;
	}

	// Specific key requested - find it or fall back to best
	const found = qualities.find((q) => q.key === preference);
	// biome-ignore lint/style/noNonNullAssertion: length checked above
	return found ?? qualities[0]!;
}

/**
 * Parse quality options from the TikTok room/info response.
 *
 * Supports both the legacy `flv_pull_url` format and the newer
 * `live_core_sdk_data` format.
 */
export function parseQualities(data: unknown): QualityOption[] {
	if (!data || typeof data !== "object") {
		return [];
	}

	const d = data as Record<string, unknown>;

	// Try new SDK format first
	const sdkQualities = parseSdkQualities(d);
	if (sdkQualities.length > 0) {
		return sdkQualities;
	}

	// Fall back to legacy flv_pull_url format
	return parseLegacyQualities(d);
}

function parseSdkQualities(data: Record<string, unknown>): QualityOption[] {
	try {
		const streamUrl = data.stream_url as Record<string, unknown> | undefined;
		if (!streamUrl) return [];

		const sdkData = streamUrl.live_core_sdk_data as
			| Record<string, unknown>
			| undefined;
		if (!sdkData) return [];

		const pullData = sdkData.pull_data as Record<string, unknown> | undefined;
		if (!pullData) return [];

		const streamDataStr = pullData.stream_data;
		if (typeof streamDataStr !== "string") return [];

		const streamData = JSON.parse(streamDataStr);
		const innerData = (streamData as Record<string, unknown>)?.data as
			| Record<string, unknown>
			| undefined;
		if (!innerData) return [];

		const qualities: QualityOption[] = [];

		for (const key of QUALITY_ORDER) {
			const q = innerData[key] as Record<string, unknown> | undefined;
			if (!q) continue;

			const main = q.main as Record<string, unknown> | undefined;
			if (!main) continue;

			const flv = main.flv;
			if (typeof flv !== "string" || flv.length === 0) continue;

			const hls = typeof main.hls === "string" ? main.hls : undefined;
			qualities.push(buildQualityOption(key, flv, hls));
		}

		return qualities;
	} catch {
		return [];
	}
}

function parseLegacyQualities(data: Record<string, unknown>): QualityOption[] {
	try {
		const streamUrl = data.stream_url as Record<string, unknown> | undefined;
		if (!streamUrl) return [];

		const flvPullUrl = streamUrl.flv_pull_url as
			| Record<string, unknown>
			| undefined;
		if (!flvPullUrl) return [];

		const qualities: QualityOption[] = [];

		// Map TikTok keys to our normalized keys
		const keyMap: Record<string, StreamQualityKey> = {
			FULL_HD1: "fullhd1",
			HD1: "hd1",
			SD2: "sd2",
			SD1: "sd1",
		};

		for (const [tikTokKey, url] of Object.entries(flvPullUrl)) {
			const key = keyMap[tikTokKey];
			if (key && typeof url === "string" && url.length > 0) {
				qualities.push(buildQualityOption(key, url));
			}
		}

		// Sort by level descending
		qualities.sort((a, b) => b.level - a.level);

		return qualities;
	} catch {
		return [];
	}
}
