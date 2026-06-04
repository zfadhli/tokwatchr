import type { Browser, ImpitOptions } from "impit";
import { Impit } from "impit";
import type { CookieJarLike } from "../types.js";

export interface CreateClientOptions {
	browser?: Browser;
	proxyUrl?: string | null;
	timeout?: number;
	headers?: Record<string, string>;
	cookieJar?: CookieJarLike | null;
}

/**
 * Create an `Impit` HTTP client configured for TikTok.
 *
 * Uses browser TLS fingerprint emulation to bypass bot detection.
 */
export function createClient(options: CreateClientOptions = {}): Impit {
	const impitOptions: ImpitOptions = {
		browser: options.browser ?? "chrome",
	};

	if (options.proxyUrl) {
		impitOptions.proxyUrl = options.proxyUrl;
	}

	if (options.timeout) {
		impitOptions.timeout = options.timeout;
	}

	if (options.headers && Object.keys(options.headers).length > 0) {
		impitOptions.headers = options.headers;
	}

	if (options.cookieJar) {
		const jar = options.cookieJar;
		impitOptions.cookieJar = {
			setCookie: (cookie: string, url: string) =>
				Promise.resolve(jar.setCookie(cookie, url)),
			getCookieString: (url: string) =>
				Promise.resolve(jar.getCookieString(url)),
		};
	}

	return new Impit(impitOptions);
}
