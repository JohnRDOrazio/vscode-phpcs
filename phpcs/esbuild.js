const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * Plugin to format build output in VS Code problem matcher format
 * @type {import("esbuild").Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: "esbuild-problem-matcher",
	setup(build) {
		build.onStart(() => {
			console.log("[watch] build started");
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				if (location) {
					// Output in format: file:line:column: ERROR: message
					// This matches the VS Code problemMatcher pattern
					console.error(
						`    ${location.file}:${location.line}:${location.column}: ERROR: ${text}`
					);
				} else {
					console.error(`✘ [ERROR] ${text}`);
				}
			});
			console.log("[watch] build finished");
		});
	},
};

/**
 * Create an esbuild context for the VS Code extension and either start file watching or perform a single rebuild and clean up.
 *
 * The build configuration targets Node CommonJS, bundles "src/extension.ts" to "dist/extension.js", treats "vscode" as external, and attaches the esbuildProblemMatcherPlugin. Behavior is affected by the top-level flags: `production` (enables minification and disables sourcemaps) and `watch` (starts persistent watch mode when true).
 */
async function main() {
	const ctx = await esbuild.context({
		entryPoints: ["src/extension.ts"],
		bundle: true,
		format: "cjs",
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: "node",
		outfile: "dist/extension.js",
		external: ["vscode"],
		logLevel: "warning",
		plugins: [esbuildProblemMatcherPlugin],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});