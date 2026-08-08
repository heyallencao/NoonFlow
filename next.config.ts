import type { NextConfig } from "next";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  outputFileTracingExcludes: {
    '*': [
      './electron/**',
      './release/**',
      './dist/**',
      './dist-electron/**',
      './resources/**',
      './.next/cache/**',
      './node_modules/.cache/**',
      './docs/**',
      './scripts/**',
      './test-results/**',
      './website/**',
      './*.md',
      './*.yml',
      './*.yaml',
      './*.config.*',
      './*.json',
      'node_modules/typescript/**',
      'node_modules/@types/**',
      'node_modules/tsx/**',
    ],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
