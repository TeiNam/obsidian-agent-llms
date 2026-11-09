import esbuild from "esbuild";
import process from "process";
import { AWS_NODE_PACKAGES, NODE_BUILTINS, nodeSubbundle } from "./esbuild-node-subbundle.mjs";

const prod = process.argv[2] === "production";

esbuild.build({
  entryPoints: ["src/main.ts"],
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
    ...NODE_BUILTINS,
  ],
  format: "cjs",
  target: "chrome106",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  plugins: [nodeSubbundle(AWS_NODE_PACKAGES)],
}).catch(() => process.exit(1));
