import { createTestRunnerConfig } from "../vitest.base";

export default createTestRunnerConfig({
  environment: "node",
  testTimeout: 60000,
  hookTimeout: 60000,
  fileParallelism: false,
  testFiles: ["tests/e2e/**/*.{test,spec}.ts"],
  extraExclude: ["tests/integration/**"],
  api: {
    host: process.env.VITEST_API_HOST || "127.0.0.1",
    port: Number(process.env.VITEST_API_PORT || 51204),
    strictPort: false,
  },
});
