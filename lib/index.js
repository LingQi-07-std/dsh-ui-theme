/**
 * dsh-client-ui-theme-bluearchive — host half.
 *
 * Ported to DSH 0.2.0: the old `settingsNamespace()` helper from
 * @deepseek-ai/dsh-settings was removed in this release, so this half declares a
 * `Config` schema and owns the custom-background endpoints. The browser half owns
 * the Arona token layer, the background art and the plugin card.
 *
 * Custom backgrounds live as plain image files on disk (NOT inside the plugin
 * package, which a reinstall wipes) and are addressed by id, so the browser only
 * ever holds a short list rather than image bytes. The list itself travels inside
 * the theme's cookie-based settings, which is exactly why uploads must be files.
 */
import Schema from "@deepseek-ai/schemastery";
import { applyBackgroundRoutes, defaultBackgroundsDir } from "./backgrounds.js";

/** Theme on/off, the preset chat background, the panel surface policy, and the
 *  titlebar / reasoning-frame appearance (the browser half reads these and only
 *  ever writes them back as CSS variables). */
export const Config = Schema.object({
	enabled: Schema.boolean().default(true),
	background: Schema.union(["none", "bg1", "bg2", "bg3"]).default("bg1"),
	panelOpacity: Schema.union(["opaque", "glass"]).default("opaque"),
	cornerArt: Schema.union(["art", "clean"]).default("art"),
	thinkAlpha: Schema.number().default(22),
	thinkInnerBubble: Schema.boolean().default(false),
	// Custom background storage. Empty means "use the default under the Electron
	// user-data directory", which survives app updates; a user-set path wins.
	backgroundsDir: Schema.string().default(""),
	// Replacement icon glyphs, as bare `path` data. The browser half rebuilds the
	// wrapper (`viewBox` + `fill="none"` + `stroke="currentColor"`), so only the path
	// is stored. Empty keeps the stock dsh glyph for that spot.
	// Text renames shown in the UI (empty = keep the theme's default wording).
	heroTitle: Schema.string().default(""),
	thinkLabel: Schema.string().default(""),
	brandIconSvg: Schema.string().default(""),
	thinkIconSvg: Schema.string().default(""),
});

/**
 * Services this host half needs before it activates.
 *
 * Declared explicitly because cordis refuses `ctx.get(<service>)` without it —
 * that exact mistake once aborted a plugin's `apply()` before any route was
 * registered, which silently took the whole plugin's HTTP surface down.
 */
export const inject = ["webServer"];

/**
 * Guards against double activation.
 *
 * This bundle can activate TWICE — once for its profile row and once for the
 * profile's `dsh.profile.bundles` entry — and the host refuses a second registration
 * of the same prefix route with
 * `webserver: duplicate prefix route "/api/theme-bluearchive/bg"`, which aborts the
 * whole plugin ("1 entry did not activate"). Registering once per process is enough,
 * so a repeat activation becomes a no-op instead of an error.
 */
let routesRegistered = false;

/**
 * Register the custom-background endpoints on the host web server.
 *
 * @param ctx - owning host context (cordis); the `webServer` service is required.
 * @param config - resolved plugin configuration (see {@link Config}).
 */
export function apply(ctx, config = {}) {
	// Defensive: the client half is the point of this plugin, so a missing web
	// server (or a rejected read) must not abort the whole bundle.
	let webServer = null;
	try {
		webServer = ctx.get("webServer") ?? ctx.webServer ?? null;
	} catch (error) {
		if (ctx.logger?.warn !== void 0) ctx.logger.warn(`bluearchive-theme: webServer unavailable: ${String(error)}`);
	}
	if (webServer === null || webServer === void 0) return;
	if (routesRegistered) return;
	routesRegistered = true;
	try {
		applyBackgroundRoutes(webServer, {
			dirOf: () => {
				const configured = typeof config.backgroundsDir === "string" ? config.backgroundsDir.trim() : "";
				return configured === "" ? defaultBackgroundsDir() : configured;
			},
			logger: ctx.logger
		});
	} catch (error) {
		// A routing conflict must never take the client half down with it: the theme
		// itself still works, only upload/delete would be unavailable. Releasing the
		// flag lets a later activation retry.
		routesRegistered = false;
		if (ctx.logger?.warn !== void 0) ctx.logger.warn(`bluearchive-theme: route registration failed: ${String(error)}`);
	}
}
