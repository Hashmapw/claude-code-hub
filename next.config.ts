import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Create next-intl plugin with i18n request configuration
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Compute asset prefix from VSCODE_PROXY_URI for reverse proxy compatibility
// VSCODE_PROXY_URI format: https://host/ws-xxx/.../proxy/{{port}}/
// We replace {{port}} with the app port (default 3000) and extract the path
function getAssetPrefix(): string | undefined {
  const proxyUri = process.env.VSCODE_PROXY_URI;
  if (!proxyUri) {
    return undefined;
  }

  try {
    // Replace {{port}} placeholder with actual port
    const port = process.env.PORT || "4000";
    const resolvedUri = proxyUri.replace("{{port}}", port);

    // Parse URL and extract path (without trailing slash for assetPrefix)
    const url = new URL(resolvedUri);
    let path = url.pathname;

    // Remove trailing slash if present
    if (path.endsWith("/")) {
      path = path.slice(0, -1);
    }

    return path || undefined;
  } catch {
    return undefined;
  }
}

const assetPrefix = getAssetPrefix();

const nextConfig: NextConfig = {
  output: "standalone",

  // Asset prefix for reverse proxy compatibility
  // Automatically computed from VSCODE_PROXY_URI environment variable
  assetPrefix,

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
  ],

  // 强制包含 undici 和 fetch-socks 到 standalone 输出
  // Next.js 依赖追踪无法正确追踪动态导入和类型导入的传递依赖
  // 参考: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
  outputFileTracingIncludes: {
    "/**": ["./node_modules/undici/**/*", "./node_modules/fetch-socks/**/*"],
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
