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
 * Create and run the esbuild build context for the project, using watch mode when enabled.
 *
 * In watch mode this starts continuous builds; otherwise it performs a single rebuild and disposes the build context after completion.
 */
async function main() {
	const ctx = await esbuild.context({
		entryPoints: ["src/server.ts"],
		bundle: true,
		format: "cjs",
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: "node",
		// Output to phpcs/dist/ so it's packaged with the extension
		outfile: "../phpcs/dist/server.js",
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