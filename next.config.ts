import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Code outlines (src/server/code) parse with tree-sitter's WebAssembly runtime and grammars: load them with Node's
  // own require so the .wasm files are read from node_modules, not bundled.
  serverExternalPackages: ["web-tree-sitter", "tree-sitter-wasms"],
  // The grammars are loaded by a computed path at runtime, so file tracing cannot see them: without this, a deployed
  // build (Vercel) ships only the runtime's tree-sitter.wasm and every file falls back to the approximate outline.
  // Only the routes that parse code need them (about 49 MB, inside Vercel's function size limit).
  outputFileTracingIncludes: {
    "/api/code": ["./node_modules/tree-sitter-wasms/package.json", "./node_modules/tree-sitter-wasms/out/*.wasm"],
    "/api/chat": ["./node_modules/tree-sitter-wasms/package.json", "./node_modules/tree-sitter-wasms/out/*.wasm"],
    "/api/specialist": ["./node_modules/tree-sitter-wasms/package.json", "./node_modules/tree-sitter-wasms/out/*.wasm"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
