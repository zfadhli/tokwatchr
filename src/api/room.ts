import type { Impit } from "impit";
import { RoomResolveError, UserNotFoundError } from "../errors.js";

export interface RoomResolveOptions {
	impIt?: Impit;
	signal?: AbortSignal;
}

/**
 * TikTok API endpoint patterns for room ID resolution.
 */
const TIKTOK_LIVE_URL = "https://www.tiktok.com/@{username}/live";
const TIKTOK_PROFILE_URL = "https://www.tiktok.com/@{username}";
const TIKTOK_API_ROOM_URL =
	"https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId={username}&sourceType=54";

/**
 * Check whether a TikTok username exists by hitting the profile page.
 * Throws UserNotFoundError if the account doesn't exist.
 */
async function checkUserExists(
	username: string,
	impIt: Impit,
	signal?: AbortSignal,
): Promise<void> {
	const url = TIKTOK_PROFILE_URL.replace("{username}", username);
	const response = await impIt.fetch(url, {
		headers: {
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"Accept-Language": "en-US,en;q=0.9",
		},
		signal,
	});

	if (response.status === 404) {
		throw new UserNotFoundError(username);
	}
}

/**
 * Resolve a TikTok username to a live room ID.
 *
 * Strategy:
 * 0. Verify the user exists (profile page check).
 * 1. Scrape the user's live page HTML for the room ID in SIGI_STATE.
 * 2. Fall back to the TikTok API.
 * 3. Throw if neither works.
 */
export async function resolveRoomId(
	username: string,
	impIt: Impit,
	options: RoomResolveOptions = {},
): Promise<string> {
	const cleanUsername = username.replace(/^@/, "").trim();

	// Strategy 0: Verify the user exists
	await checkUserExists(cleanUsername, impIt, options.signal);

	// Strategy 1: Scrape the live page
	const roomId = await tryScrapeRoomId(cleanUsername, impIt, options.signal);
	if (roomId) {
		return roomId;
	}

	// Strategy 2: Use the API
	const apiRoomId = await tryApiRoomId(cleanUsername, impIt, options.signal);
	if (apiRoomId) {
		return apiRoomId;
	}

	throw new RoomResolveError(cleanUsername);
}

/**
 * Try to extract room ID from the TikTok live page HTML.
 */
async function tryScrapeRoomId(
	username: string,
	impIt: Impit,
	signal?: AbortSignal,
): Promise<string | null> {
	try {
		const url = TIKTOK_LIVE_URL.replace("{username}", username);
		const response = await impIt.fetch(url, {
			headers: {
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
			},
			signal,
		});

		if (!response.ok) {
			return null;
		}

		const html = await response.text();

		// Try SIGI_STATE JSON first
		const roomId = extractRoomIdFromSigiState(html);
		if (roomId) return roomId;

		// Fallback: regex for "roomId":"<digits>"
		const roomIdMatch = html.match(/"roomId"\s*:\s*"(\d+)"/);
		if (roomIdMatch?.[1]) return roomIdMatch[1];

		// Fallback: regex for room_id=<digits>
		const roomIdParamMatch = html.match(/room_id=(\d+)/);
		if (roomIdParamMatch?.[1]) return roomIdParamMatch[1];

		return null;
	} catch {
		return null;
	}
}

/**
 * Try to extract room ID from SIGI_STATE embedded JSON.
 */
function extractRoomIdFromSigiState(html: string): string | null {
	try {
		const match = html.match(
			/<script[^>]*id=["']SIGI_STATE["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i,
		);
		if (!match) return null;

		const sigiState = JSON.parse(match[1] as string);

		// Traverse potential paths
		const liveRoom = sigiState?.LiveRoom?.liveRoomInfo;
		if (liveRoom?.roomId) {
			return String(liveRoom.roomId);
		}

		// Alternate path
		const liveRoom2 = sigiState?.LiveRoom?.liveRoomInfo?.user?.roomId;
		if (liveRoom2) {
			return String(liveRoom2);
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Try to resolve room ID via the TikTok API.
 */
async function tryApiRoomId(
	username: string,
	impIt: Impit,
	signal?: AbortSignal,
): Promise<string | null> {
	try {
		const url = TIKTOK_API_ROOM_URL.replace(
			"{username}",
			encodeURIComponent(username),
		);
		const response = await impIt.fetch(url, {
			headers: {
				Accept: "application/json, text/plain, */*",
				Referer: `https://www.tiktok.com/@${username}`,
			},
			signal,
		});

		if (!response.ok) {
			return null;
		}

		const data = (await response.json()) as Record<string, unknown>;
		const dataObj = data.data as Record<string, unknown> | undefined;

		if (!dataObj) return null;

		// Check status - 2 means live
		const liveRoom = dataObj.liveRoom as Record<string, unknown> | undefined;
		if (liveRoom?.status !== 2) return null;

		const user = dataObj.user as Record<string, unknown> | undefined;
		if (!user) return null;

		const roomId = user.roomId;
		if (roomId) {
			return String(roomId);
		}

		return null;
	} catch {
		return null;
	}
}
