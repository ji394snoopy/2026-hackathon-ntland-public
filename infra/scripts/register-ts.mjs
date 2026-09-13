// Minimal on-the-fly TypeScript loader for `node --test`, built on esbuild (already an
// infra devDependency — no new package). Registers a module-resolution + load hook so
// `node --test ... lambda/produce-comparison/*.test.ts` can import the co-located .ts
// source directly, without a separate compile step or ts-node.
//
// Scope: only transforms .ts files (strips types, keeps ESM). Type-only imports (e.g.
// `import type { ... } from "../shared/db"`) are erased by esbuild, so these pure-function
// tests never pull in drizzle / the RDS Data API client at runtime.

import { register } from "node:module";

register(new URL("./ts-loader.mjs", import.meta.url));
