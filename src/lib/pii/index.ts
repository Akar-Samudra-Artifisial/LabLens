export {
  allowRange,
  allowUnit,
  allowValue,
  canonicalTestName,
  type CloudRow,
  crossRowPii,
  type DropReason,
  type DroppedRow,
  MAX_CLOUD_ROWS,
  MAX_FIELD_DIGITS,
  plausibleNik,
  sanitizeForCloud,
} from "./allowlist";
export {
  assertPayloadClean,
  buildCloudPayload,
  type CloudPayload,
  DEFAULT_PAYLOAD_LANGUAGE,
  EXPLAIN_PROMPT,
  EXPLAIN_PROMPTS,
  PAYLOAD_LANGUAGES,
  type PayloadLanguage,
  payloadPiiKinds,
  utf8Bytes,
} from "./cloud-payload";
export { detectPii } from "./detect";
export {
  assertFallbackClean,
  buildFallbackText,
  fallbackPiiKinds,
  FALLBACK_EXTRACT_PROMPT,
  type FallbackLockReason,
  FallbackLockedError,
  type FallbackPayload,
  type LabLine,
  MAX_FALLBACK_BYTES,
  parseLabLine,
} from "./fallback-text";
export { assertNoPii, findPii, PiiLeakError } from "./guard";
export { countByKind, type KnownPii, knownPiiFrom, redactText, SPAN_KIND_LABEL, SPAN_PLACEHOLDERS } from "./redact";
export type { Bbox, FooterZone, HeaderZone, OcrPage, PiiDetection, PiiSpan, PiiSpanKind } from "./types";
