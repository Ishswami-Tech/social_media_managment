import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@platform/ai-anthropic",
    "@platform/ai-core",
    "@platform/ai-google",
    "@platform/ai-openai",
    "@platform/config",
    "@platform/database",
    "@platform/encryption",
    "@platform/media",
    "@platform/queue",
    "@platform/rbac",
    "@platform/social-core",
    "@platform/social-linkedin",
    "@platform/social-meta",
    "@platform/types",
    "@platform/whatsapp",
  ],
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "sharp",
    "bullmq",
    "ioredis",
    "@aws-sdk/client-s3",
  ],
  output: "standalone",
  // Monorepo: trace files from the workspace root so standalone output includes packages/*.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
