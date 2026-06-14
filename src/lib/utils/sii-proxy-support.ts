const DISABLED_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

function readProxySupportEnv(): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }

  return process.env.NEXT_PUBLIC_SII_PROXY_SUPPORT ?? process.env.SII_PROXY_SUPPORT;
}

export function isSiiProxySupportEnabled(): boolean {
  const rawValue = readProxySupportEnv();
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return true;
  }

  return !DISABLED_VALUES.has(rawValue.trim().toLowerCase());
}
