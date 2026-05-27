/**
 * Simple token estimator. Uses a character-based heuristic:
 * - CJK characters count as ~1 token each
 * - Other text: ~4 bytes per token (UTF-8)
 * This avoids the tiktoken dependency while giving reasonable estimates.
 */
export function estimateTextTokens(text: unknown): number {
  if (typeof text !== "string") return 0;
  const normalized = text.trim();
  if (!normalized) return 0;

  let total = 0;
  let buffer = "";

  function flushBuffer(): void {
    if (!buffer) return;
    const byteLen = new TextEncoder().encode(buffer).length;
    total += Math.max(1, Math.ceil(byteLen / 4));
    buffer = "";
  }

  for (const char of normalized) {
    if (isCjkChar(char)) {
      flushBuffer();
      total += 1;
      continue;
    }
    if (/\s/.test(char)) {
      flushBuffer();
      continue;
    }
    buffer += char;
  }

  flushBuffer();
  return total;
}

function isCjkChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0x3040 && code <= 0x309F) ||
    (code >= 0x30A0 && code <= 0x30FF) ||
    (code >= 0xAC00 && code <= 0xD7AF)
  );
}
