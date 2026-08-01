// esbuild.vault.mjs — dev build that writes directly into the vault plugin folder.
// Lets you iterate on desktop without cutting a release. BRAT still owns the
// folder for real installs; this just overwrites main.js while developing.
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";
import path from "path";

const VAULT_PLUGIN_DIR =
	process.env.OBSIDIAN_PLUGIN_DIR ||
	"C:/Users/Shawn/Documents/Workspace/Shawn's Vault/.obsidian/plugins/shawns-toolbox";

if (!fs.existsSync(VAULT_PLUGIN_DIR)) {
	console.error(`Plugin dir not found: ${VAULT_PLUGIN_DIR}`);
	process.exit(1);
}

// Keep manifest.json and styles.css in sync alongside main.js
for (const f of ["manifest.json", "styles.css"]) {
	fs.copyFileSync(f, path.join(VAULT_PLUGIN_DIR, f));
}

const watch = process.argv[2] === "watch";

const context = await esbuild.context({
	entryPoints: ["main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: "inline",
	treeShaking: true,
	outfile: path.join(VAULT_PLUGIN_DIR, "main.js"),
});

if (watch) {
	await context.watch();
	console.log(`Watching → ${VAULT_PLUGIN_DIR}`);
} else {
	await context.rebuild();
	await context.dispose();
	console.log(`Built → ${VAULT_PLUGIN_DIR}`);
}
