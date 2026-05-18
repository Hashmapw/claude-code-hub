import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Create next-intl plugin with i18n request configuration
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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

    let pathname: string;
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

  // 转译 ESM 模块（@lobehub/icons 需要）
  transpilePackages: ["@lobehub/icons"],

  // 排除服务端专用包（避免打包到客户端）
  // bull 和相关依赖只在服务端使用，包含 Node.js 原生模块
  // postgres 和 drizzle-orm 包含 Node.js 原生模块（net, tls, crypto, stream, perf_hooks）
  serverExternalPackages: [
    "bull",
    "bullmq",
    "@bull-board/api",
    "@bull-board/express",
    "ioredis",
    "postgres",
    "drizzle-orm",
    "@langfuse/core",
    "@langfuse/otel",
    "@langfuse/tracing",
    "@opentelemetry/sdk-node",
    "@opentelemetry/sdk-trace-base",
  ],

  // 强制包含 undici 和 fetch-socks 到 standalone 输出
  // Next.js 依赖追踪无法正确追踪动态导入和类型导入的传递依赖
  // 参考: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/undici/**/*",
      "./node_modules/fetch-socks/**/*",
      // 自定义 Node 服务器（server.js）只用到 `ws` 与 next 的入口；
      // 让 Next 的依赖追踪决定从 next 包里收纳什么文件，避免把 next 整个
      // node_modules 都拖进 standalone 产物（约数十 MB）。仅显式追加：
      //  - ws：standalone 默认追踪基于 import 静态分析，server.js 是 CJS
      //    根入口，未被 Next 编译，必须手工列出。
      //  - next/dist：自定义 server 通过 require("next") 进入；保留 dist
      //    子树确保 programmatic API 可用。
      "./node_modules/ws/**/*",
      "./node_modules/next/dist/**/*",
      "./node_modules/next/package.json",
    ],
  },

  // 文件上传大小限制（用于数据库备份导入）
  // Next.js 15 通过 serverActions.bodySizeLimit 统一控制
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
    proxyClientMaxBodySize: "100mb",
  },
};

// Wrap the Next.js config with next-intl plugin
export default withNextIntl(nextConfig);
