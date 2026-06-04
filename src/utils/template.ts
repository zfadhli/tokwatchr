/**
 * Render a filename template with runtime values.
 *
 * Available variables:
 * - {username} - TikTok username
 * - {date}     - Current date in YYYYMMDD format
 * - {time}     - Current time in HHmmss format
 * - {title}    - Stream title (sanitized)
 *
 * Default template: "{username}={date}_{time}"
 */
export function renderFilename(
	template: string,
	values: {
		username: string;
		title?: string;
		date?: string;
		time?: string;
		part?: number;
	},
): string {
	const now = new Date();
	const date = values.date ?? formatDate(now);
	const time = values.time ?? formatTime(now);

	let result = template;
	result = result.replaceAll("{username}", values.username);
	result = result.replaceAll("{date}", date);
	result = result.replaceAll("{time}", time);

	if (values.title) {
		result = result.replaceAll("{title}", sanitize(values.title));
	}

	if (values.part !== undefined) {
		result = result.replaceAll("{part}", String(values.part));
	}

	return result;
}

function formatDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}${m}${d}`;
}

function formatTime(date: Date): string {
	const h = String(date.getHours()).padStart(2, "0");
	const m = String(date.getMinutes()).padStart(2, "0");
	const s = String(date.getSeconds()).padStart(2, "0");
	return `${h}${m}${s}`;
}

/**
 * Sanitize a string for use in filenames.
 * Replaces characters that are problematic across OSes.
 */
function sanitize(input: string): string {
	return input
		.replaceAll(/[/\\?%*:|"<>]/g, "_")
		.replaceAll(/\s+/g, "_")
		.replaceAll(/_+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 64);
}
