import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

function getAssetPrefix(): string | undefined {
  const proxyUri = process.env.VSCODE_PROXY_URI || process.env.vscode_proxy_uri;
  if (!proxyUri) return undefined;
  try {
    const port = process.env.PORT || "4000";
    return proxyUri.replaceAll("{{port}}", port).replace(/\/+$/, "") || undefined;
  } catch {
    return undefined;
  }
}

const nextConfig: NextConfig = {
  output: "standalone",

  assetPrefix: getAssetPrefix(),

  transpilePackages: ["@lobehub/icons"],

  serverExternalPackages: [
    "bull",
    "bullmq",
    "@bull-board/api",
    "@bull-board/express",
    "ioredis",
    "postgres",
    "drizzle-orm",
  ],

  outputFileTracingIncludes: {
    "/**": ["./node_modules/undici/**/*", "./node_modules/fetch-socks/**/*"],
  },

  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
    proxyClientMaxBodySize: "100mb",
  },
};

export default withNextIntl(nextConfig);
