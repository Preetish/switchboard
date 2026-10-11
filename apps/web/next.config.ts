import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not build output.
  transpilePackages: ["@switchboard/core", "@switchboard/db", "@switchboard/calendar-google", "@switchboard/crm-hubspot"],
  // Keep the queue runtime as plain Node requires (ESM-only package with
  // dynamic adapter imports the bundler should not try to trace).
  serverExternalPackages: ["pg-boss"],
  webpack: (config) => {
    // packages use NodeNext-style "./x.js" imports that map to "./x.ts".
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
