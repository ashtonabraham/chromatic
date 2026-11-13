import type { NextConfig } from "next";

const config: NextConfig = {
  // The palette index is read from disk at runtime, which build tracing can't
  // see on its own, so ship it with every server route.
  outputFileTracingIncludes: { "/**": ["./data/palettes.json"] },
};

export default config;
