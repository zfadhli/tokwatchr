/**
 * Format a byte count into a human-readable string.
 *
 * @example formatBytes(1_234_567) // "1.2 MB"
 */
export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format a duration in seconds to a concise string.
 *
 * @example formatDuration(3661) // "1h 1m 1s"
 */
export function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);

	const parts: string[] = [];
	if (h > 0) parts.push(`${h}h`);
	if (m > 0) parts.push(`${m}m`);
	parts.push(`${s}s`);

	return parts.join(" ");
}

/**
 * Format a speed in bytes/sec to a human-readable string.
 *
 * @example formatSpeed(3_200_000) // "3.1 MB/s"
 */
export function formatSpeed(bytesPerSec: number): string {
	const units = ["B/s", "KB/s", "MB/s", "GB/s"];
	let value = bytesPerSec;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	return `${value.toFixed(1)} ${units[unitIndex]}`;
}
