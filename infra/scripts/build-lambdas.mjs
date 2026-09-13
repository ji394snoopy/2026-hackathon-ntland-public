#!/usr/bin/env node
// Bundles the lambda/ handlers flagged bundled:true in lambdas.json into self-contained
// ESM files under infra/build/lambda/<name>/index.mjs, which the CDK LambdaStack then
// ships via lambda.Code.fromAsset — mirroring the existing self-contained zoning-filter
// asset pattern (no Docker, no runtime install of deps).
//
// The handlers are authored NodeNext-style: their relative imports carry a ".js" extension
// that actually points at a sibling ".ts" source (e.g. `import ... from "./layers.js"`
// resolves to layers.ts under tsx/tsc). esbuild does not rewrite ".js" -> ".ts" on its
// own, so the resolve plugin below maps those specifiers back to the real .ts files.

import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const infraRoot = resolve(__dirname, "..");

// Rewrites relative "./x.js" / "../x.js" specifiers to the co-located ".ts" source when
// a .js file doesn't actually exist there — the lambda handlers are authored NodeNext-style
// (imports carry a ".js" extension that points at a sibling ".ts"). Bare package specifiers
// (pngjs, etc.) and real .js files are left untouched for esbuild to bundle normally from
// node_modules.
const jsToTsPlugin = {
  name: "js-to-ts",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.path.startsWith(".")) return null; // bare import (a dependency)
      const jsPath = resolve(args.resolveDir, args.path);
      if (existsSync(jsPath)) return null; // a genuine .js file — bundle as-is
      const tsPath = jsPath.replace(/\.js$/, ".ts");
      if (existsSync(tsPath)) return { path: tsPath };
      return null;
    });
  },
};

// The list of handlers to bundle is driven by infra/lambda/lambdas.json (the single
// source of truth for "what lambdas does infra ship"), so this build step and the
// human-readable manifest can't drift apart. Only entries flagged `bundled: true` need
// esbuild here; `bundled: false` ones (e.g. zoning-filter) already have their source
// living in infra and are shipped straight via Code.fromAsset.
const manifestPath = resolve(infraRoot, "lambda", "lambdas.json");
if (!existsSync(manifestPath)) {
  throw new Error(`Lambda manifest not found: ${manifestPath}`);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const handlers = (manifest.lambdas ?? [])
  .filter((l) => l.bundled)
  .map((l) => ({
    name: l.name,
    // `source` in the manifest is relative to infra/; resolve it against infraRoot.
    entry: resolve(infraRoot, l.source),
  }));

if (handlers.length === 0) {
  throw new Error(
    `No bundled handlers found in ${manifestPath} (expected at least one entry with "bundled": true).`,
  );
}

for (const { name, entry } of handlers) {
  if (!existsSync(entry)) {
    throw new Error(`Handler entry not found: ${entry}`);
  }
  const outfile = resolve(infraRoot, "build", "lambda", name, "index.mjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    // Node 22 runtime provides global fetch/Buffer; bundle everything else (pngjs, pg).
    // pg-native / pg-cloudflare are optional deps pg tries to load dynamically; they
    // aren't installed and aren't needed (pg falls back to its pure-JS socket path), so
    // mark them external to stop esbuild failing on the unresolved dynamic require.
    // @aws-sdk/* is provided by the Node 22 Lambda runtime, so keep it external to avoid
    // bundling the (large) SDK — the facilities Data API repo uses @aws-sdk/client-rds-data
    // at runtime from the runtime-provided copy.
    external: ["pg-native", "pg-cloudflare", "cloudflare:sockets", "@aws-sdk/*"],
    // The Bedrock/PDF handlers inline binary assets they can't readFileSync at runtime
    // (Lambda ships only the bundle, cwd is /var/task): the district-survey template PDF
    // and the Chinese .ttf font become Uint8Array via the `binary` loader. Vocabulary /
    // coordinates .json use esbuild's built-in json loader (no entry needed). Note
    // @anthropic-ai/bedrock-sdk + @anthropic-ai/sdk are deliberately NOT external — they
    // aren't in the Node 22 runtime, so they must be bundled (installed here in infra).
    loader: { ".ttf": "binary", ".pdf": "binary" },
    // pngjs is CommonJS and does `require("util")` etc. In an ESM bundle Node has no
    // global `require`, so esbuild's shim throws "Dynamic require of ... is not
    // supported". Recreate a real `require` (bound to this module's URL) so those
    // Node-builtin requires resolve at runtime.
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        "const require = __createRequire(import.meta.url);",
      ].join("\n"),
    },
    // All handler deps (pngjs, pdf-lib, @anthropic-ai/*, pdfjs-dist, ...) are installed
    // here in infra. Point esbuild's node resolution at infra's node_modules explicitly so
    // handlers under lambda/ resolve their bare imports from the same place.
    nodePaths: [resolve(infraRoot, "node_modules")],
    plugins: [jsToTsPlugin],
    logLevel: "info",
    // esbuild emits `export { handler }`; the Lambda handler string is "index.handler".
  });
  console.log(`Built ${name} -> ${outfile}`);
}

console.log(`\nBuilt ${handlers.length} Lambda bundle(s).`);
