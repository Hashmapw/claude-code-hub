/**
 * Preset Configuration Management
 *
 * Manages pre-configured test payloads from relay-pulse project.
 * These presets provide authentic CLI request patterns that pass
 * relay service client verification.
 */

import type { ProviderType } from "@/types/provider";

// Import preset JSON files
import ccBase from "./data/cc_base.json";
import ccSonnet from "./data/cc_sonnet.json";
import cxBase from "./data/cx_base.json";
import publicCcBase from "./data/public_cc_base.json";

// ============================================================================
// Types
// ============================================================================

export interface PresetConfig {
  /** Unique identifier for the preset */
  id: string;
  /** Human-readable description */
  description: string;
  /** Provider types this preset is compatible with */
  providerTypes: ProviderType[];
  /** The request payload template */
  payload: Record<string, unknown>;
  /** Default success detection keyword */
  defaultSuccessContains: string;
  /** Default model used in this preset */
  defaultModel: string;
}

// ============================================================================
// Preset Definitions
// ============================================================================

/**
 * All available preset configurations
 */
export const PRESETS: Record<string, PresetConfig> = {
  cc_base: {
    id: "cc_base",
    description: "Claude CLI base (haiku, fast)",
    providerTypes: ["claude", "claude-auth"],
    payload: ccBase,
    defaultSuccessContains: "isNewTopic",
    defaultModel: "claude-haiku-4-5-20251001",
  },
  cc_sonnet: {
    id: "cc_sonnet",
    description: "Claude CLI sonnet (with cache)",
    providerTypes: ["claude", "claude-auth"],
    payload: ccSonnet,
    defaultSuccessContains: "pong",
    defaultModel: "claude-sonnet-4-5-20250929",
  },
  public_cc_base: {
    id: "public_cc_base",
    description: "Public/Community Claude (thinking enabled)",
    providerTypes: ["claude", "claude-auth"],
    payload: publicCcBase,
    defaultSuccessContains: "pong",
    defaultModel: "claude-sonnet-4-5-20250929",
  },
  cx_base: {
    id: "cx_base",
    description: "Codex CLI (Response API)",
    providerTypes: ["codex", "openai-compatible"],
    payload: cxBase,
    defaultSuccessContains: "pong",
    defaultModel: "gpt-5-codex",
  },
};

const SESSION_MARKER = "account__session_";
const SESSION_ROTATE_PRESETS = new Set(["cc_base", "cc_sonnet", "public_cc_base"]);
const PROMPT_CACHE_KEY_ROTATE_PRESETS = new Set(["cx_base"]);

type PresetMetadata = {
  user_id?: unknown;
};

function createSessionUuid(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  // Fallback for runtimes without Web Crypto randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (placeholder) => {
    const randomNibble = Math.floor(Math.random() * 16);
    const nibble = placeholder === "x" ? randomNibble : (randomNibble & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

function createRandomBytes(length: number): Uint8Array {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint8Array(length));
  }

  const bytes = new Uint8Array(length);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function createRandomHex(length: number): string {
  const bytesLength = Math.ceil(length / 2);
  const randomBytes = createRandomBytes(bytesLength);
  const randomHex = Array.from(randomBytes)
    .map((byteValue) => byteValue.toString(16).padStart(2, "0"))
    .join("");
  return randomHex.slice(0, length);
}

function createUuidV7(): string {
  const unixTimeMsHex = Date.now().toString(16).padStart(12, "0").slice(-12);
  const randA = createRandomHex(3);
  const variantNibbleOptions = ["8", "9", "a", "b"] as const;
  const variantNibble =
    variantNibbleOptions[Number.parseInt(createRandomHex(1), 16) % variantNibbleOptions.length];
  const randBHead = createRandomHex(3);
  const randBTail = createRandomHex(12);

  return `${unixTimeMsHex.slice(0, 8)}-${unixTimeMsHex.slice(8, 12)}-7${randA}-${variantNibble}${randBHead}-${randBTail}`;
}

function rotateCcPresetSessionUserId(presetId: string, payload: Record<string, unknown>): void {
  if (!SESSION_ROTATE_PRESETS.has(presetId)) {
    return;
  }

  if (!payload.metadata || typeof payload.metadata !== "object") {
    return;
  }

  const metadata = payload.metadata as PresetMetadata;
  if (typeof metadata.user_id !== "string") {
    return;
  }

  const markerIndex = metadata.user_id.indexOf(SESSION_MARKER);
  if (markerIndex < 0) {
    return;
  }

  const prefix = metadata.user_id.slice(0, markerIndex + SESSION_MARKER.length);
  metadata.user_id = `${prefix}${createSessionUuid()}`;
}

function rotateCxPresetPromptCacheKey(presetId: string, payload: Record<string, unknown>): void {
  if (!PROMPT_CACHE_KEY_ROTATE_PRESETS.has(presetId)) {
    return;
  }

  if (typeof payload.prompt_cache_key !== "string") {
    return;
  }

  payload.prompt_cache_key = createUuidV7();
}

/**
 * Mapping of provider types to available presets
 */
export const PRESET_MAPPING: Record<ProviderType, string[]> = {
  claude: ["cc_base", "cc_sonnet", "public_cc_base"],
  "claude-auth": ["cc_base", "cc_sonnet", "public_cc_base"],
  codex: ["cx_base"],
  "openai-compatible": ["cx_base"],
  gemini: [], // Gemini uses its own format
  "gemini-cli": [],
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Get available presets for a provider type
 */
export function getPresetsForProvider(providerType: ProviderType): PresetConfig[] {
  const presetIds = PRESET_MAPPING[providerType] || [];
  return presetIds.map((id) => PRESETS[id]).filter(Boolean);
}

/**
 * Get a specific preset by ID
 */
export function getPreset(presetId: string): PresetConfig | undefined {
  return PRESETS[presetId];
}

/**
 * Get preset payload with optional model override
 *
 * @param presetId - The preset identifier
 * @param model - Optional model to override the default
 * @returns The payload object with model applied
 */
export function getPresetPayload(presetId: string, model?: string): Record<string, unknown> {
  const preset = PRESETS[presetId];
  if (!preset) {
    throw new Error(`Preset not found: ${presetId}`);
  }

  // Deep clone to avoid mutating the original
  const payload = JSON.parse(JSON.stringify(preset.payload)) as Record<string, unknown>;

  // Override model if provided
  if (model) {
    payload.model = model;
  }

  rotateCcPresetSessionUserId(presetId, payload);
  rotateCxPresetPromptCacheKey(presetId, payload);

  return payload;
}

/**
 * Check if a preset is compatible with a provider type
 */
export function isPresetCompatible(presetId: string, providerType: ProviderType): boolean {
  const presetIds = PRESET_MAPPING[providerType] || [];
  return presetIds.includes(presetId);
}

/**
 * Get default preset for a provider type
 * Returns the first available preset or undefined
 */
export function getDefaultPreset(providerType: ProviderType): PresetConfig | undefined {
  const presets = getPresetsForProvider(providerType);
  return presets[0];
}
