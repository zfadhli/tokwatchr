import type { Impit } from "impit";
import { StreamFetchError } from "../errors.js";
import type { StreamInfo, StreamQualityKey } from "../types.js";
import { parseQualities, selectQuality } from "../utils/quality.js";

export interface StreamInfoOptions {
	quality?: "best" | "worst" | StreamQualityKey;
	signal?: AbortSignal;
}

/**
 * Lightweight check whether a room is currently alive.
 * Uses TikTok's `check_alive` endpoint — one request, fast response.
 */
export async function checkRoomAlive(
	roomId: string,
	impIt: Impit,
	signal?: AbortSignal,
): Promise<boolean> {
	const url = `https://webcast.tiktok.com/webcast/room/check_alive/?aid=1988&region=CH&room_ids=${encodeURIComponent(roomId)}&user_is_login=true`;
	try {
		const response = await impIt.fetch(url, { signal });
		if (!response.ok) return false;
		const json = (await response.json()) as Record<string, unknown>;
		const data = json.data as Array<Record<string, unknown>> | undefined;
		return data?.[0]?.alive === true;
	} catch {
		return false;
	}
}

/**
 * Fetch stream info for a given room ID.
 *
 * Calls the TikTok webcast room/info API and parses the response
 * to extract stream URLs and quality options.
 */
export async function fetchStreamInfo(
	roomId: string,
	username: string,
	impIt: Impit,
	options: StreamInfoOptions = {},
): Promise<StreamInfo> {
	const url = `https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=${encodeURIComponent(roomId)}`;

	const response = await impIt.fetch(url, {
		headers: {
			Accept: "application/json, text/plain, */*",
			Referer: `https://www.tiktok.com/@${username}/live`,
		},
		signal: options.signal,
	});

	if (!response.ok) {
		throw new StreamFetchError(
			roomId,
			`HTTP ${response.status}: ${response.statusText}`,
		);
	}

	const json = (await response.json()) as Record<string, unknown>;
	const data = json.data as Record<string, unknown> | undefined;

	if (!data) {
		throw new StreamFetchError(roomId, "No data in response");
	}

	const status = data.status;
	if (status !== 2) {
		throw new StreamFetchError(roomId, `Room is not live (status: ${status})`);
	}

	const qualities = parseQualities(data);
	if (qualities.length === 0) {
		throw new StreamFetchError(roomId, "No stream qualities found");
	}

	const selectedQuality = selectQuality(qualities, options.quality ?? "best");

	const title = typeof data.title === "string" ? data.title : "";
	const viewerCount =
		typeof (data.stats as Record<string, unknown> | undefined)?.viewer_count ===
		"number"
			? ((data.stats as Record<string, unknown>).viewer_count as number)
			: 0;

	return {
		roomId,
		username,
		title,
		qualities,
		selectedQuality,
		streamUrl: selectedQuality.flv,
		viewerCount,
		startedAt: new Date(),
	};
}
