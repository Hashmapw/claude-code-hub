/**
 * Next.js Instrumentation Hook
 *
 * Keep this entrypoint Edge-safe: Next.js also analyzes instrumentation for the
 * Edge runtime, so Node-only imports and process APIs must stay behind the
 * NEXT_RUNTIME nodejs branch.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { registerNodeInstrumentation } = await import("./instrumentation.node");
  await registerNodeInstrumentation();
}
