import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Code outlines (src/server/code) parse with tree-sitter's WebAssembly runtime and grammars: load them with Node's
  // own require so the .wasm files are read from node_modules, not bundled.
  serverExternalPackages: ["web-tree-sitter", "tree-sitter-wasms"],
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
