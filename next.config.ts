import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating Next.js dev-tools indicator (the colored "N" icon).
  devIndicators: false,
  // Native/server-only drivers must stay outside the server bundle so they are
  // required from node_modules at runtime (better-sqlite3 for the local SQLite
  // file; the libSQL client for remote Turso on serverless hosts).
  serverExternalPackages: ["better-sqlite3", "@libsql/client"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
