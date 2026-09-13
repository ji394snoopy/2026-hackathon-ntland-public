// esbuild-backed Node loader hooks (paired with register-ts.mjs). Resolves extensionless
// relative TS imports and transforms .ts source to ESM on load. Used only by
// `npm run test:comparison` — not part of the Lambda bundle (build-lambdas.mjs handles that).

import { transform } from "esbuild";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TS_EXT = ".ts";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".")) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const parentDir = dirname(parentPath);

    // NodeNext-style ".js" specifier that actually points at a sibling ".ts" (the lambda
    // handlers are authored this way). Mirror build-lambdas.mjs's js->ts plugin: only remap
    // when the ".js" doesn't exist but the ".ts" does; leave real .js files alone.
    if (specifier.endsWith(".js")) {
      const jsPath = resolvePath(parentDir, specifier);
      if (!existsSync(jsPath)) {
        const tsPath = jsPath.replace(/\.js$/, ".ts");
        if (existsSync(tsPath)) {
          return { url: pathToFileURL(tsPath).href, shortCircuit: true };
        }
      }
    }

    // Extensionless relative import (e.g. "./rules") -> the .ts file.
    if (!specifier.endsWith(".ts") && !specifier.endsWith(".mjs") && !specifier.endsWith(".js")) {
      const candidate = resolvePath(parentDir, `${specifier}.ts`);
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}

// Binary asset extensions the lambda handlers import (esbuild `binary` loader in the real
// bundle). Locally we emit an ESM module whose default export is a Uint8Array, matching
// what the handlers expect (they do `templatePdfBytes as Uint8Array`).
const BINARY_EXTS = [".pdf", ".ttf"];

export async function load(url, context, nextLoad) {
  if (url.endsWith(TS_EXT)) {
    const source = await readFile(fileURLToPath(url), "utf8");
    const { code } = await transform(source, {
      loader: "ts",
      format: "esm",
      target: "node22",
      sourcemap: "inline",
    });
    return { format: "module", source: code, shortCircuit: true };
  }

  // Binary asset (.pdf/.ttf) imported as a default Uint8Array — mirror esbuild's `binary`
  // loader so the fill-* handlers run under this loader the same way they do when bundled.
  if (BINARY_EXTS.some((ext) => url.endsWith(ext))) {
    const bytes = await readFile(fileURLToPath(url));
    const b64 = bytes.toString("base64");
    const mod = `const b = Buffer.from("${b64}", "base64");\nexport default new Uint8Array(b.buffer, b.byteOffset, b.byteLength);`;
    return { format: "module", source: mod, shortCircuit: true };
  }

  return nextLoad(url, context);
}
