import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const projectRoot = dirname(fileURLToPath(import.meta.url));

function collapseDuplicatedLeadingProxyPrefix(path: string): string {
  let current = path;
  for (let i = 0; i < 8; i++) {
    const firstProxyMatch = current.match(/^\/proxy\/(\d+)(?:\/|$)/);
    const firstPort = firstProxyMatch?.[1];
    if (!firstPort) {
      return current;
    }

    const firstPrefix = `/proxy/${firstPort}`;
    const rest = current.slice(firstPrefix.length);
    if (!rest.startsWith("/")) {
      return current;
    }

    if (/^\/ws-[^/]+(?:\/|$)/.test(rest)) {
      current = rest;
      continue;
    }

    const repeatedPattern = new RegExp(`/proxy/${firstPort}(?:/|$)`, "g");
    const repeatedMatches = [...current.matchAll(repeatedPattern)];
    if (repeatedMatches.length >= 2) {
      current = rest;
      continue;
    }

    return current;
  }

  return current;
}

function getAssetPrefix(): string | undefined {
  const proxyUri = process.env.VSCODE_PROXY_URI || process.env.vscode_proxy_uri;
  if (!proxyUri) {
    return undefined;
  }

  try {
    const port = process.env.PORT || "3000";
    const resolved = proxyUri.replaceAll("{{port}}", port).replace(/\/+$/, "");
    if (!resolved) {
      return undefined;
    }

    let pathname = resolved;
    try {
      pathname = new URL(resolved).pathname;
    } catch {
      pathname = new URL(resolved, "http://localhost").pathname;
    }

    const normalizedPath = collapseDuplicatedLeadingProxyPrefix(pathname).replace(/\/+$/, "");
    return normalizedPath || undefined;
  } catch {
    return undefined;
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  assetPrefix: getAssetPrefix(),
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },

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
