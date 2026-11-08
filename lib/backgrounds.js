/**
 * Custom-background storage for the Arona theme.
 *
 * Design constraints that shape this module:
 *
 * - The theme's settings live in a COOKIE (DSH picks a random web port each
 *   launch, so localStorage does not survive). Cookies cannot carry images, so
 *   image bytes must be files on disk and the browser only keeps a short list.
 * - Files must NOT live inside the plugin package: a `pnpm` reinstall replaces
 *   that directory wholesale (we lost plugin data to exactly that twice).
 * - Requests are restricted to loopback callers, because this writes to disk.
 *
 * Storage layout: `<dir>/<id>.<ext>` where `id` is a slug derived from the
 * original file name plus a short random suffix, so two uploads of the same name
 * never collide and the id is safe to embed in a URL.
 *
 * @module dsh-client-ui-theme-bluearchive/backgrounds
 */

import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Directory of this module, used to locate the bundled icon assets. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Route prefix for every background endpoint. */
export const BG_ROUTE = "/api/theme-bluearchive/bg";

/**
 * Route that re-encodes an uploaded video so looping is seamless.
 *
 * Playback stalls at the loop point when the keyframe interval is long, so the
 * transcode pins `-g 12 -bf 0` and strips audio. Work is asynchronous: POST
 * returns a job id, GET polls its progress, and the result lands in the normal
 * background directory so it can be served like any other upload.
 */
export const TRANSCODE_ROUTE = "/api/theme-bluearchive/transcode";

/**
 * Route serving/accepting the compressed thumbnail of a stored background.
 * Cached as `<dir>/.thumbs/<id>.webp` so the settings grid never decodes a
 * full-size image just to show a 120px tile.
 */
export const THUMB_ROUTE = "/api/theme-bluearchive/thumb";

/** Route holding the persisted theme settings (background selection, random flag). */
export const SETTINGS_ROUTE = "/api/theme-bluearchive/settings";

/** Route serving this plugin's own icon assets (brand glyph + animated whale). */
export const ASSET_ROUTE = "/api/theme-bluearchive/asset";

/** Route serving the startup-animation page and the two images it needs. */
export const STARTUP_ROUTE = "/api/theme-bluearchive/startup";

/** Route serving the custom mouse-pointer image. */
export const CURSOR_ROUTE = "/api/theme-bluearchive/cursor";

/**
 * The pointer PNG lives inside the cloned BA-Pointer package, not next to the
 * other bundled assets, so it gets its own route instead of an entry above.
 * A 24×24 copy is served: CSS `cursor` draws the image at its intrinsic size,
 * and the 64×64 original rendered far too large.
 */
const CURSOR_FILE = ["assets", "BA-Pointer-main", "BA.Pointer", "Assets", "PCIcon_MousePoint_24.png"];

/**
 * Files the startup route may serve, keyed by request name.
 *
 * The page expects both images next to it, so they are served from the same
 * prefix with their original names.
 */
const STARTUP_FILES = {
	"animation.html": "startup-animation.html",
	// WebP: the 4K PNGs were ~3MB each and decoded too slowly to paint fully before
	// the splash revealed (only the top band showed). WebP is ~120-250KB per image.
	"light1.webp": "light1.webp",
	"light2.webp": "light2.webp",
	"dark1.webp": "dark1.webp",
	"dark2.webp": "dark2.webp"
};

/**
 * Bundled icon assets, keyed by the name used in a request.
 *
 * The brand mark is a static SVG.
 *
 * The thinking icon is served as BOTH an SVG and an APNG, because they behave
 * differently: an animated SVG does not play when used as a CSS `mask`, while the
 * supplied APNG turned out to contain only the halo layer (its 28x28 canvas has no
 * whale body). The client therefore uses the SVG as a mask over an `<img>`, which
 * keeps the SMIL animation AND allows `currentColor` tinting.
 */
const ASSET_FILES = {
	"brand.svg": "brand-fish-logo.svg",
	"think.svg": "thinking-whale.svg",
	"think.png": "thinking-whale-animated.png"
};

/** MIME type per asset extension. */
const ASSET_MIME = {
	".svg": "image/svg+xml",
	".png": "image/png"
};

/**
 * Settings file name, written next to the background directory.
 *
 * The browser half keeps its settings in a cookie, but a cookie write silently
 * disappears once the 127.0.0.1 jar is full (several plugins share that origin).
 * That presented as "my selection is not remembered" and as the random switch
 * flipping itself back off. The same JSON is therefore mirrored to disk, and the
 * file wins on load.
 */
const SETTINGS_FILE = "settings.json";

/** Bytes allowed per uploaded background (4K wallpaper class). */
export const MAX_BG_BYTES = 20 * 1024 * 1024;

/** Bytes allowed per uploaded background VIDEO. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** Extensions accepted, mapped to the MIME type used when serving them back. */
const MIME_BY_EXT = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".mp4": "video/mp4",
	".webm": "video/webm"
};

/** `image` or `video`, derived from the accepted MIME type. */
function kindOfMime(mime) {
	return String(mime).startsWith("video/") ? "video" : "image";
}

/** How many background slots the card offers. Keep in sync with the client's MAX_SLOTS. */
export const MAX_BACKGROUNDS = 20;

/**
 * Default storage directory.
 *
 * `%APPDATA%\@deepseek-ai\dsh-desktop` is Electron's per-user data directory for
 * this app: it survives application updates and, unlike the plugin package, is
 * not replaced on reinstall. `DSH_THEME_BG_DIR` overrides it for tests.
 *
 * @returns absolute directory path.
 */
export function defaultBackgroundsDir() {
	const override = process.env.DSH_THEME_BG_DIR;
	if (typeof override === "string" && override.trim() !== "") return override.trim();
	const appData = process.env.APPDATA;
	const base = typeof appData === "string" && appData.trim() !== ""
		? join(appData, "@deepseek-ai", "dsh-desktop")
		: join(homedir(), ".dsh-desktop");
	return join(base, "arona-theme", "backgrounds");
}

/** Whether a request came from this machine (these routes write to disk). */
function isLoopback(req) {
	try {
		const peer = req.socket?.remoteAddress ?? "";
		const host = String(req.headers?.host ?? "");
		const localPeer = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
		const localHost = host.startsWith("127.0.0.1") || host.startsWith("localhost") || host.startsWith("[::1]");
		return localPeer && localHost;
	} catch (_) {
		return false;
	}
}

/**
 * Reduce a user file name to a safe slug.
 *
 * @param name - original file name from the browser.
 * @returns slug containing only `[a-z0-9-]`, never empty.
 */
function slugOf(name) {
	const stem = basename(String(name ?? ""), extname(String(name ?? "")));
	const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	return slug === "" ? "bg" : slug.slice(0, 40);
}

/** Random suffix so repeated uploads of one name stay distinct. */
function randomSuffix() {
	return Math.random().toString(36).slice(2, 8);
}

/** Read the request body as a Buffer, refusing anything over the size cap. */
function readBinary(req, limit) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;
		req.on("data", (chunk) => {
			total += chunk.length;
			if (total > limit) {
				reject(new Error("too-large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

/** List stored backgrounds: `{ id, name, bytes, url }`. */
function listBackgrounds(dir) {
	let names;
	try {
		names = readdirSync(dir);
	} catch (_) {
		return [];
	}
	const items = [];
	for (const name of names) {
		// Dot-files are internal (transcode scratch files, thumbnail dir).
		if (name.startsWith(".")) continue;
		const ext = extname(name).toLowerCase();
		if (MIME_BY_EXT[ext] === undefined) continue;
		const id = name.slice(0, -ext.length);
		let bytes = 0;
		try {
			bytes = statSync(join(dir, name)).size;
		} catch (_) {
			continue;
		}
		items.push({
			id,
			name: id,
			bytes,
			url: `${BG_ROUTE}/${encodeURIComponent(name)}`,
			kind: kindOfMime(MIME_BY_EXT[ext]),
			// Both kinds get a cached preview: the browser renders a video's first frame
			// into a WebP, so the grid never has to keep a <video> element alive per tile.
			thumb: `${THUMB_ROUTE}?name=${encodeURIComponent(id)}`
		});
	}
	items.sort((a, b) => a.id.localeCompare(b.id));
	return items;
}

/**
 * Resolve a stored file name inside the directory, refusing path escapes.
 *
 * @param dir - storage directory.
 * @param name - request path segment.
 * @returns absolute path, or null when it escapes or does not exist.
 */
function resolveStored(dir, name) {
	const decoded = decodeURIComponent(String(name ?? ""));
	if (decoded === "" || decoded.includes("/") || decoded.includes("\\") || decoded.includes("..")) return null;
	if (MIME_BY_EXT[extname(decoded).toLowerCase()] === undefined) return null;
	const abs = resolve(join(dir, decoded));
	const root = resolve(dir);
	// Containment: the resolved path must sit directly in the root. Compared
	// case-insensitively (Windows paths are), because a raw `startsWith` rejects a
	// differently-cased root and would 404 legitimate files.
	const inside = abs.slice(0, root.length).toLowerCase() === root.toLowerCase();
	if (!inside || basename(abs) !== basename(decoded)) return null;
	try {
		if (!statSync(abs).isFile()) return null;
	} catch (_) {
		return null;
	}
	return abs;
}

/**
 * Find a stored file by ID (the file name without its extension).
 *
 * The card surface refers to backgrounds by bare id while the bytes live as
 * `<id>.<ext>`. Resolving by id keeps the two consistent: an earlier version had
 * the client ask the delete route for a bare id while the route only accepted a
 * full file name, so every delete answered 404.
 *
 * @param dir - storage directory.
 * @param id - stored background id (no extension).
 * @returns absolute path, or null when nothing matches.
 */
function resolveById(dir, id) {
	const wanted = decodeURIComponent(String(id ?? ""));
	if (wanted === "" || wanted.includes("/") || wanted.includes("\\") || wanted.includes("..") || wanted.includes(".")) return null;
	let names;
	try {
		names = readdirSync(dir);
	} catch (_) {
		return null;
	}
	const stem = wanted.toLowerCase();
	for (const name of names) {
		const ext = extname(name).toLowerCase();
		if (MIME_BY_EXT[ext] === undefined) continue;
		if (name.slice(0, -ext.length).toLowerCase() !== stem) continue;
		const abs = resolve(join(dir, name));
		try {
			if (statSync(abs).isFile()) return abs;
		} catch (_) { /* skip unreadable entry */ }
	}
	return null;
}

/**
 * Register the custom-background endpoints.
 *
 * `GET    /api/theme-bluearchive/bg`        → JSON list
 * `POST   /api/theme-bluearchive/bg?name=`  → store the raw body (Blob upload)
 * `DELETE /api/theme-bluearchive/bg/<id>`   → remove one (by id, no extension)
 * `GET    /api/theme-bluearchive/bg/<file>` → serve the image (full file name)
 * `GET    /api/theme-bluearchive/settings`  → persisted theme settings JSON
 * `PUT    /api/theme-bluearchive/settings`  → replace them (JSON body)
 *
 * @param webServer - host web server service.
 * @param options - `dirOf()` returns the storage directory; `logger` is optional.
 */
export function applyBackgroundRoutes(webServer, options) {
	const dirOf = options.dirOf;
	const logger = options.logger;
	const ensureDir = () => {
		const dir = dirOf();
		mkdirSync(dir, { recursive: true });
		return dir;
	};
	const json = (res, body, status = 200) => {
		const text = JSON.stringify(body);
		res.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			"content-length": Buffer.byteLength(text)
		});
		res.end(text);
	};

	webServer.register({
		kind: "prefix",
		path: BG_ROUTE,
		async handler(req, res) {
			if (!isLoopback(req)) {
				json(res, { ok: false, error: "forbidden" }, 403);
				return;
			}
			const method = String(req.method ?? "GET").toUpperCase();
			const pathname = String(req.url ?? "").split("?")[0];
			const rest = pathname.startsWith(BG_ROUTE) ? pathname.slice(BG_ROUTE.length).replace(/^\//, "") : "";
			try {
				// ── list ────────────────────────────────────────────────────────────
				if (rest === "" && method === "GET") {
					const dir = ensureDir();
					json(res, {
						ok: true,
						dir,
						max: MAX_BACKGROUNDS,
						maxBytes: MAX_BG_BYTES,
						maxVideoBytes: MAX_VIDEO_BYTES,
						items: listBackgrounds(dir)
					});
					return;
				}
				// ── upload (raw binary body; the browser sends a Blob) ──────────────
				if (rest === "" && method === "POST") {
					const query = new URL(String(req.url ?? "/"), "http://localhost").searchParams;
					const original = query.get("name") ?? "background";
					const ext = extname(original).toLowerCase();
					const mime = MIME_BY_EXT[ext];
					if (mime === undefined) {
						json(res, { ok: false, error: "unsupported-type", message: "仅支持 png / jpg / webp / gif / mp4 / webm" }, 400);
						return;
					}
					const video = kindOfMime(mime) === "video";
					const body = await readBinary(req, video ? MAX_VIDEO_BYTES : MAX_BG_BYTES);
					if (body.length === 0) {
						json(res, { ok: false, error: "empty-body" }, 400);
						return;
					}
					const dir = ensureDir();
					if (listBackgrounds(dir).length >= MAX_BACKGROUNDS) {
						json(res, { ok: false, error: "full", message: `最多 ${String(MAX_BACKGROUNDS)} 张背景` }, 409);
						return;
					}
					const file = `${slugOf(original)}-${randomSuffix()}${ext}`;
					writeFileSync(join(dir, file), body);
					json(res, { ok: true, items: listBackgrounds(dir), added: file });
					return;
				}
				// ── delete (by id; falls back to a full file name) ───────────────────
				if (rest !== "" && method === "DELETE") {
					const dir = ensureDir();
					// The card surface addresses backgrounds by id, so resolve by id first
					// and accept a full file name as well for direct API use.
					const target = resolveById(dir, rest) ?? resolveStored(dir, rest);
					if (target === null) {
						json(res, { ok: false, error: "not-found" }, 404);
						return;
					}
					// Windows keeps a handle open while the app plays the clip, so a plain
					// unlink answers EBUSY. Retry briefly before giving up.
					let removed = false;
					let lastError = null;
					for (let attempt = 0; attempt < 8 && !removed; attempt += 1) {
						try {
							unlinkSync(target);
							removed = true;
						} catch (error) {
							lastError = error;
							if (error.code !== "EBUSY" && error.code !== "EPERM") break;
							await new Promise((resolve) => { setTimeout(resolve, 150); });
						}
					}
					if (!removed) {
						json(res, {
							ok: false,
							error: "busy",
							message: "文件正在被占用（可能仍在使用该壁纸），请稍后再试：" + String(lastError && lastError.message)
						}, 409);
						return;
					}
					// The thumbnail cache lives as long as the image itself: drop it here
					// so a re-upload under the same id can never serve a stale preview.
					try {
						const base = basename(target);
						unlinkSync(join(dir, ".thumbs", `${base.slice(0, -extname(base).length)}.webp`));
					} catch (_) { /* no cached thumb */ }
					json(res, { ok: true, items: listBackgrounds(dir) });
					return;
				}
				// ── serve one file (image or video, with byte ranges) ────────────────
				if (rest !== "" && (method === "GET" || method === "HEAD")) {
					const dir = ensureDir();
					const target = resolveStored(dir, rest);
					if (target === null) {
						json(res, { ok: false, error: "not-found" }, 404);
						return;
					}
					const mime = MIME_BY_EXT[extname(target).toLowerCase()];
					let size = 0;
					try {
						size = statSync(target).size;
					} catch (_) {
						json(res, { ok: false, error: "not-found" }, 404);
						return;
					}
					// Video playback REQUIRES byte ranges: the browser asks for `bytes=0-`
					// on first play and re-requests offsets when seeking. Answering 200 to
					// a range request leaves the player unable to seek, and some builds
					// refuse to start at all. Images tolerate ranges too, so both go
					// through the same path.
					const range = String(req.headers.range ?? "").trim();
					const match = /^bytes=(\d*)-(\d*)$/.exec(range);
					if (match !== null && method === "GET") {
						let start = match[1] === "" ? 0 : Number(match[1]);
						let end = match[2] === "" ? size - 1 : Number(match[2]);
						if (!Number.isFinite(start) || !Number.isFinite(end)) { start = 0; end = size - 1; }
						if (start < 0) start = 0;
						if (end >= size) end = size - 1;
						if (start > end) {
							res.writeHead(416, { "content-range": `bytes */${String(size)}` });
							res.end();
							return;
						}
						res.writeHead(206, {
							"content-type": mime,
							"content-length": end - start + 1,
							"content-range": `bytes ${String(start)}-${String(end)}/${String(size)}`,
							"accept-ranges": "bytes",
							"cache-control": "public, max-age=31536000, immutable"
						});
						createReadStream(target, { start, end }).pipe(res);
						return;
					}
					res.writeHead(200, {
						"content-type": mime,
						"content-length": size,
						"accept-ranges": "bytes",
						"cache-control": "public, max-age=31536000, immutable"
					});
					if (method === "HEAD") {
						res.end();
						return;
					}
					createReadStream(target).pipe(res);
					return;
				}
				json(res, { ok: false, error: "method-not-allowed" }, 405);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (logger !== undefined && logger !== null && typeof logger.warn === "function") {
					logger.warn(`bluearchive-theme: background route failed: ${message}`);
				}
				if (message === "too-large") {
					const img = String(Math.round(MAX_BG_BYTES / 1024 / 1024));
					const vid = String(Math.round(MAX_VIDEO_BYTES / 1024 / 1024));
					json(res, { ok: false, error: "too-large", message: `图片上限 ${img} MB，视频上限 ${vid} MB` }, 413);
					return;
				}
				json(res, { ok: false, error: "internal", message }, 500);
			}
		}
	});

	// ── bundled icon assets ──────────────────────────────────────────────────────
	webServer.register({
		kind: "prefix",
		path: ASSET_ROUTE,
		async handler(req, res) {
			const method = String(req.method ?? "GET").toUpperCase();
			if (method !== "GET" && method !== "HEAD") {
				json(res, { ok: false, error: "method-not-allowed" }, 405);
				return;
			}
			const pathname = String(req.url ?? "").split("?")[0];
			const name = pathname.startsWith(ASSET_ROUTE) ? pathname.slice(ASSET_ROUTE.length).replace(/^\//, "") : "";
			const file = ASSET_FILES[decodeURIComponent(name)];
			if (file === undefined) {
				json(res, { ok: false, error: "not-found" }, 404);
				return;
			}
			try {
				const bytes = readFileSync(join(MODULE_DIR, "assets", file));
				res.writeHead(200, {
					"content-type": ASSET_MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
					"content-length": bytes.byteLength,
					// Bundled per plugin version: safe to cache hard, and a restart re-registers.
					"cache-control": "public, max-age=86400"
				});
				res.end(req.method === "HEAD" ? undefined : bytes);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (logger !== undefined && logger !== null && typeof logger.warn === "function") {
					logger.warn(`bluearchive-theme: icon asset ${file} unreadable: ${message}`);
				}
				json(res, { ok: false, error: "not-found", message }, 404);
			}
		}
	});

	// ── startup animation (the page plus the two images it needs) ─────────────────
	webServer.register({
		kind: "prefix",
		path: STARTUP_ROUTE,
		async handler(req, res) {
			const method = String(req.method ?? "GET").toUpperCase();
			if (method !== "GET" && method !== "HEAD") {
				json(res, { ok: false, error: "method-not-allowed" }, 405);
				return;
			}
			const pathname = String(req.url ?? "").split("?")[0];
			const name = pathname.startsWith(STARTUP_ROUTE) ? pathname.slice(STARTUP_ROUTE.length).replace(/^\//, "") : "";
			const file = STARTUP_FILES[decodeURIComponent(name)];
			if (file === undefined) {
				json(res, { ok: false, error: "not-found" }, 404);
				return;
			}
			try {
				// The assets live beside `lib/`, at the package root.
				const abs = join(MODULE_DIR, "..", "assets", file);
				let body = readFileSync(abs);
				if (extname(file).toLowerCase() === ".html") {
					// The page ships with a demo auto-load that would start peeling before
					// the app has painted. The client calls `resolveStartup()` at the right
					// moment instead, so the flag is rewritten on the way out and the source
					// file keeps its standalone preview behaviour.
					body = Buffer.from(
						String(body).replace(/const DEMO_AUTO_LOAD = true;/, "const DEMO_AUTO_LOAD = false;"),
						"utf8"
					);
				}
				const ext = extname(file).toLowerCase();
				res.writeHead(200, {
					"content-type": ext === ".html" ? "text/html; charset=utf-8" : (ext === ".webp" ? "image/webp" : "image/png"),
					"content-length": body.byteLength,
					"cache-control": "no-cache"
				});
				res.end(method === "HEAD" ? undefined : body);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (logger !== undefined && logger !== null && typeof logger.warn === "function") {
					logger.warn(`bluearchive-theme: startup asset ${file} unreadable: ${message}`);
				}
				json(res, { ok: false, error: "not-found", message }, 404);
			}
		}
	});

	// ── custom mouse pointer ──────────────────────────────────────────────────────
	webServer.register({
		kind: "exact",
		path: CURSOR_ROUTE,
		async handler(req, res) {
			const method = String(req.method ?? "GET").toUpperCase();
			if (method !== "GET" && method !== "HEAD") {
				json(res, { ok: false, error: "method-not-allowed" }, 405);
				return;
			}
			try {
				const bytes = readFileSync(join(MODULE_DIR, "..", ...CURSOR_FILE));
				res.writeHead(200, {
					"content-type": "image/png",
					"content-length": bytes.byteLength,
					// Versioned with the package; a restart re-registers the route.
					"cache-control": "public, max-age=86400"
				});
				res.end(method === "HEAD" ? undefined : bytes);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (logger !== undefined && logger !== null && typeof logger.warn === "function") {
					logger.warn(`bluearchive-theme: cursor asset unreadable: ${message}`);
				}
				json(res, { ok: false, error: "not-found", message }, 404);
			}
		}
	});

	// ── video transcode (async job + progress polling) ──────────────────────────
	const transcodeJobs = new Map();
	webServer.register({
		kind: "exact",
		path: TRANSCODE_ROUTE,
		async handler(req, res) {
			if (!isLoopback(req)) {
				json(res, { ok: false, error: "forbidden" }, 403);
				return;
			}
			const method = String(req.method ?? "GET").toUpperCase();
			const query = new URL(String(req.url ?? "/"), "http://localhost").searchParams;
			// ── poll ────────────────────────────────────────────────────────────────
			if (method === "GET") {
				const job = transcodeJobs.get(String(query.get("id") ?? ""));
				if (job === undefined) {
					json(res, { ok: false, error: "not-found" }, 404);
					return;
				}
				json(res, {
					ok: true,
					progress: job.progress,
					done: job.done,
					failed: job.failed,
					file: job.file,
					message: job.message
				});
				return;
			}
			// ── cancel ──────────────────────────────────────────────────────────────
			// Dismissing the dialog must not leave a half-written clip or an orphan
			// ffmpeg process behind: kill the child and drop both temp and output.
			if (method === "DELETE") {
				const id = String(query.get("id") ?? "");
				const job = transcodeJobs.get(id);
				if (job === undefined) {
					json(res, { ok: true, cancelled: false });
					return;
				}
				try { if (job.child !== null && job.child !== undefined) job.child.kill("SIGKILL"); } catch (_) { /* gone */ }
				const dir = ensureDir();
				try { unlinkSync(join(dir, `.transcode-${id}.mp4`)); } catch (_) { /* never written */ }
				try {
					if (typeof job.file === "string" && job.done !== true) unlinkSync(join(dir, job.file));
				} catch (_) { /* partial output */ }
				transcodeJobs.delete(id);
				json(res, { ok: true, cancelled: true });
				return;
			}
			if (method !== "POST") {
				json(res, { ok: false, error: "method-not-allowed" }, 405);
				return;
			}
			// ── start ───────────────────────────────────────────────────────────────
			const original = String(query.get("name") ?? "background.mp4");
			const ext = extname(original).toLowerCase();
			if (MIME_BY_EXT[ext] === undefined || ext !== ".mp4") {
				json(res, { ok: false, error: "unsupported-type", message: "仅支持 mp4 转码" }, 400);
				return;
			}
			const body = await readBinary(req, MAX_VIDEO_BYTES);
			if (body.length === 0) {
				json(res, { ok: false, error: "empty-body" }, 400);
				return;
			}
			const dir = ensureDir();
			const id = `${slugOf(original)}-${randomSuffix()}`;
			const tmp = join(dir, `.transcode-${id}.mp4`);
			const outName = `${id}.mp4`;
			const out = join(dir, outName);
			try {
				writeFileSync(tmp, body);
			} catch (error) {
				json(res, { ok: false, error: "write-failed", message: String(error) }, 500);
				return;
			}
			const job = { progress: 0, done: false, failed: false, file: outName, message: "" };
			transcodeJobs.set(id, job);
			json(res, { ok: true, id });
			// Encode options (all user choices; resolution is never touched).
			const fpsParam = String(query.get("fps") ?? "source");
			const fpsArgs = fpsParam === "30" || fpsParam === "60" ? ["-r", fpsParam] : [];
			const gopParam = String(query.get("gop") ?? "auto");
			const codecParam = String(query.get("codec") ?? "h264");
			// Bitrate: "auto" keeps quality-constant (crf), a number switches to a target
			// rate so size and quality are predictable. `maxrate` equals the target
			// (CBR-ish): allowing 1.5x let a "83M" encode land ABOVE the 90M source.
			const bitrateParam = String(query.get("bitrate") ?? "auto");
			const bitrateValue = /^\d+(\.\d+)?$/.test(bitrateParam) ? Number(bitrateParam) : 0;
			const rateArgs = bitrateValue > 0
				? ["-b:v", bitrateValue + "M", "-maxrate", bitrateValue + "M", "-bufsize", String(bitrateValue) + "M"]
				: [];
			const codecArgs = codecParam === "h265"
				? ["-c:v", "libx265", "-preset", "medium", "-pix_fmt", "yuv420p",
					...(bitrateValue > 0 ? rateArgs : ["-crf", bitrateParam === "cap" ? "20" : "30"]), "-tag:v", "hvc1"]
				: ["-c:v", "libx264", "-preset", "medium", "-profile:v", "high", "-bf", "2", "-pix_fmt", "yuv420p",
					// Quality mode uses a low crf (visible gain); size mode pushes crf up so
					// the two modes actually differ. With the same crf the cap never fired.
					...(bitrateValue > 0 ? rateArgs : ["-crf", bitrateParam === "cap" ? "19" : "26"])];
			/**
			 * Pick a GOP that divides the clip into whole pieces.
			 *
			 * A loop restarts at frame 0 (an I-frame), so what actually matters is that the
			 * LAST GOP is complete — a truncated tail is what produces the visible stutter.
			 * Probing frame count is too slow for 4K, so duration x fps is used and the
			 * largest divisor <= 300 is taken (falls back to 12 when nothing divides well).
			 */
			const gopValue = await (async () => {
				if (gopParam === "short") return 12;
				if (gopParam === "default") return 0;
				const frames = await new Promise((resolve) => {
					const probe = spawn("ffprobe", [
						"-v", "error", "-select_streams", "v:0",
						"-show_entries", "stream=r_frame_rate",
						"-show_entries", "format=duration",
						"-of", "default=noprint_wrappers=1", tmp
					], { windowsHide: true });
					let text = "";
					probe.stdout.on("data", (chunk) => { text += String(chunk); });
					probe.on("error", () => resolve(0));
					probe.on("close", () => {
						const duration = Number((/duration=([\d.]+)/.exec(text) ?? [])[1]);
						const rate = (/r_frame_rate=(\d+)\/(\d+)/.exec(text) ?? []);
						const fps = rate.length === 3 ? Number(rate[1]) / Number(rate[2]) : 0;
						const total = duration > 0 && fps > 0 ? Math.round(duration * fps) : 0;
						resolve(Number.isFinite(total) && total > 0 ? total : 0);
					});
				});
				if (frames === 0) return 12;
				let best = 0;
				for (let g = 12; g <= Math.min(300, frames); g += 1) {
					if (frames % g === 0) best = g;
				}
				return best > 0 ? best : 12;
			})();
			const gopArgs = gopValue > 0 ? ["-g", String(gopValue)] : [];
			// "cap": quality-first CRF, but the source bitrate becomes a hard ceiling, so
			// the result can never exceed the original. ffmpeg has no "reuse the input
			// bitrate" flag, so the ceiling has to be probed and passed explicitly.
			const capArgs = bitrateParam === "cap"
				? await (async () => {
					const source = await new Promise((resolve) => {
						const probe = spawn("ffprobe", [
							"-v", "error", "-select_streams", "v:0",
							"-show_entries", "stream=bit_rate",
							"-show_entries", "format=bit_rate",
							"-of", "default=noprint_wrappers=1", tmp
						], { windowsHide: true });
						let text = "";
						probe.stdout.on("data", (chunk) => { text += String(chunk); });
						probe.on("error", () => resolve(0));
						probe.on("close", () => {
							const values = [...text.matchAll(/bit_rate=(\d+)/g)].map((m) => Number(m[1]));
							const max = values.length > 0 ? Math.max(...values) : 0;
							resolve(Number.isFinite(max) && max > 0 ? max : 0);
						});
					});
					if (source === 0) return [];
					const mbps = Math.max(1, Math.floor((source / 1e6) * 10) / 10);
					return ["-maxrate", mbps + "M", "-bufsize", String(mbps * 2) + "M"];
				})()
				: [];
			// Re-encode in the background; the app polls `GET ?id=`.
			let child;
			try {
				child = spawn("ffmpeg", [
					"-y", "-i", tmp,
					...codecArgs,
					...capArgs,
					...gopArgs,
					...fpsArgs,
					"-movflags", "+faststart", "-an", out
				], { windowsHide: true });
			} catch (error) {
				job.done = true;
				job.failed = true;
				job.message = String(error);
				try { unlinkSync(tmp); } catch (_) { /* ignore */ }
				return;
			}
			// `-progress pipe:1` is not used; stderr carries `time=HH:MM:SS.xx`.
			// The stream is chunked arbitrarily, so a tail buffer keeps a `Duration:` or
			// `time=` token that straddles two chunks from being lost (that left the
			// progress bar pinned at 0% for the whole encode).
			let progressTail = "";
			child.stderr.on("data", (chunk) => {
				progressTail += String(chunk);
				if (progressTail.length > 8192) progressTail = progressTail.slice(-8192);
				const duration = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(progressTail);
				if (duration !== null) {
					job.duration = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
				}
				const times = [...progressTail.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
				if (times.length > 0 && job.duration > 0) {
					const last = times[times.length - 1];
					const secs = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
					job.progress = Math.min(99, Math.round((secs / job.duration) * 100));
				}
			});
			child.on("error", (error) => {
				job.done = true;
				job.failed = true;
				job.message = String(error);
				try { unlinkSync(tmp); } catch (_) { /* ignore */ }
			});
			child.on("close", (code) => {
				try { unlinkSync(tmp); } catch (_) { /* ignore */ }
				job.done = true;
				if (code !== 0 || !existsSync(out)) {
					job.failed = true;
					job.message = `ffmpeg exited with ${String(code)}`;
					return;
				}
				job.progress = 100;
				job.file = outName;
			});
		}
	});

	// ── background thumbnails ────────────────────────────────────────────────────
	webServer.register({
		kind: "exact",
		path: THUMB_ROUTE,
		async handler(req, res) {
			if (!isLoopback(req)) {
				json(res, { ok: false, error: "forbidden" }, 403);
				return;
			}
			const method = String(req.method ?? "GET").toUpperCase();
			const query = new URL(String(req.url ?? "/"), "http://localhost").searchParams;
			const id = String(query.get("name") ?? "").replace(/\.[^./\\]*$/, "");
			if (id === "" || id.includes("..") || id.includes("/") || id.includes("\\")) {
				json(res, { ok: false, error: "bad-name" }, 400);
				return;
			}
			const dir = ensureDir();
			const thumbDir = join(dir, ".thumbs");
			const file = join(thumbDir, `${id}.webp`);
			if (method === "GET" || method === "HEAD") {
				try {
					const bytes = readFileSync(file);
					res.writeHead(200, {
						"content-type": "image/webp",
						"content-length": bytes.byteLength,
						// Thumbnails never change for a given id.
						"cache-control": "public, max-age=31536000, immutable"
					});
					res.end(method === "HEAD" ? undefined : bytes);
				} catch (_) {
					json(res, { ok: false, error: "not-found" }, 404);
				}
				return;
			}
			if (method === "POST") {
				const body = await readBinary(req, 512 * 1024);
				if (body.length === 0) {
					json(res, { ok: false, error: "empty-body" }, 400);
					return;
				}
				mkdirSync(thumbDir, { recursive: true });
				writeFileSync(file, body);
				json(res, { ok: true });
				return;
			}
			json(res, { ok: false, error: "method-not-allowed" }, 405);
		}
	});

	// ── persisted settings (mirror of the cookie) ────────────────────────────────
	const settingsPath = () => join(dirOf(), "..", SETTINGS_FILE);
	webServer.register({
		kind: "exact",
		path: SETTINGS_ROUTE,
		async handler(req, res) {
			if (!isLoopback(req)) {
				json(res, { ok: false, error: "forbidden" }, 403);
				return;
			}
			const method = String(req.method ?? "GET").toUpperCase();
			try {
				const file = resolve(settingsPath());
				if (method === "GET") {
					try {
						json(res, { ok: true, settings: JSON.parse(readFileSync(file, "utf8")) });
					} catch (_) {
						// No file yet (first run) or unreadable: an empty object is a valid answer.
						json(res, { ok: true, settings: {} });
					}
					return;
				}
				if (method === "PUT" || method === "POST") {
					const body = await readBinary(req, 256 * 1024);
					const parsed = JSON.parse(body.toString("utf8"));
					if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
						json(res, { ok: false, error: "bad-body" }, 400);
						return;
					}
					mkdirSync(dirOf(), { recursive: true });
					writeFileSync(file, JSON.stringify(parsed, null, 2), "utf8");
					json(res, { ok: true });
					return;
				}
				json(res, { ok: false, error: "method-not-allowed" }, 405);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (logger !== undefined && logger !== null && typeof logger.warn === "function") {
					logger.warn(`bluearchive-theme: settings route failed: ${message}`);
				}
				json(res, { ok: false, error: "internal", message }, 500);
			}
		}
	});
}
