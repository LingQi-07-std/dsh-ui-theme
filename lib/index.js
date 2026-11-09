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
import { applyBackgroundRoutes, defaultBackgroundsDir } from "./backgrounds.js";

/**
 * NO exported `Config`.
 *
 * The plugin is loaded from a `file:` path (`_stage\pkgs\...`), which cannot
 * resolve DSH's bundled `@deepseek-ai/schemastery`; importing it aborted the whole
 * bundle with `ERR_MODULE_NOT_FOUND`. Exporting a PLAIN object instead is also
 * rejected — the loader treats `Config` as a schema and calls `Config.validate()`,
 * throwing `Cannot read properties of undefined (reading 'validate')`.
 *
 * So the host half declares no schema. Every setting lives in the in-app card,
 * which persists through the settings API; this half only needs defaults for
 * `apply()`.
 */
const DEFAULTS = {
	enabled: true,
	background: "default",
	panelOpacity: "opaque",
	cornerArt: "art",
	thinkAlpha: 22,
	thinkInnerBubble: false,
	backgroundsDir: "",
	heroTitle: "",
	thinkLabel: "",
	brandIconSvg: "",
	thinkIconSvg: ""
};

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
