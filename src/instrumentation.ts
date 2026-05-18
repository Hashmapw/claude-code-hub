/**
 * Next.js Instrumentation Hook
 *
 * Keep this entrypoint Edge-safe: Next.js may statically analyze it for both
 * runtimes. All Node.js APIs and Node-only imports live in instrumentation-node.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { registerNodeInstrumentation } = await import("./instrumentation-node");
  await registerNodeInstrumentation();
}
