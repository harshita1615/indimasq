// Build the extension into dist/.
//
//   npm run build
//
// Bundles the scripts with esbuild-wasm (WebAssembly, no
// native binary) and copies the static files. Output is not minified, so the
// published code stays readable for Chrome Web Store review and for users.

import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import * as esbuild from "esbuild-wasm";

const root = new URL("../", import.meta.url);
const pdfjs = "node_modules/pdfjs-dist/";
const dist = new URL("dist/", root);

const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf-8"));
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf-8"));
if (manifest.version !== pkg.version) {
  throw new Error(`manifest.json version ${manifest.version} != package.json ${pkg.version}`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await esbuild.build({
  absWorkingDir: new URL(".", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  entryPoints: {
    content: "src/content/index.ts",
    popup: "src/popup/popup.ts",
    "main-world": "src/content/main-world.ts",
    background: "src/background/background.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  charset: "utf8",
  legalComments: "none",
  logLevel: "warning",
});

// The PDF page loads pdf.js, which is an ES module.
await esbuild.build({
  absWorkingDir: new URL(".", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  entryPoints: { offscreen: "src/offscreen/offscreen.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome120",
  charset: "utf8",
  legalComments: "none",
  logLevel: "warning",
});

for (const [from, to] of [
  ["manifest.json", "manifest.json"],
  ["src/popup/popup.html", "popup.html"],
  ["src/popup/popup.css", "popup.css"],
  ["icons", "icons"],
  ["_locales", "_locales"],
  ["src/offscreen/offscreen.html", "offscreen.html"],
  ["THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.txt"],
  // pdf.js: its worker, the standard fonts PDFs refer to, and its image decoders
  // (the plain-JavaScript ones; see useWasm in offscreen.ts). Bundled: nothing is downloaded.
  [`${pdfjs}build/pdf.worker.min.mjs`, "pdf/pdf.worker.min.mjs"],
  [`${pdfjs}standard_fonts`, "pdf/standard_fonts"],
  ...["openjpeg_nowasm_fallback.js", "jbig2_nowasm_fallback.js"].map((f) => [
    `${pdfjs}wasm/${f}`,
    `pdf/wasm/${f}`,
  ]),
]) {
  cpSync(new URL(from, root), new URL(to, dist), { recursive: true });
}

console.log(`built kavach extension ${manifest.version} into dist/`);
