import type { NextConfig } from "next";

/**
 * Who may embed the hosted form in an iframe (`frame-ancestors`). Defaults
 * to any site so the embed snippet works out of the box; set
 * EMBED_ALLOWED_ORIGINS to a space-separated list (e.g.
 * "https://www.acme.com https://acme.com") to restrict it.
 */
function embedAncestors(): string {
  const raw = process.env.EMBED_ALLOWED_ORIGINS?.trim();
  return raw ? `'self' ${raw}` : "*";
}

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not build output.
  transpilePackages: ["@switchboard/core", "@switchboard/db", "@switchboard/calendar-google", "@switchboard/crm-hubspot"],
  // Keep the queue runtime as plain Node requires (ESM-only package with
  // dynamic adapter imports the bundler should not try to trace).
  serverExternalPackages: ["pg-boss"],
  poweredByHeader: false,
  async headers() {
    return [
      // Everything except the hosted form: never framed (clickjacking guard
      // for the admin pages and OAuth flows).
      {
        source: "/((?!f/).*)",
        headers: [
          ...baseHeaders,
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      // The hosted form is embeddable (see docs/embed.md).
      {
        source: "/f/:path*",
        headers: [
          ...baseHeaders,
          { key: "Content-Security-Policy", value: `frame-ancestors ${embedAncestors()}` },
        ],
      },
    ];
  },
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
