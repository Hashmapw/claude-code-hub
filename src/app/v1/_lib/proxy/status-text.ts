import { STATUS_CODES } from "node:http";

export function resolveHttpStatusText(statusCode: number): string {
  return STATUS_CODES[statusCode] ?? "";
}
