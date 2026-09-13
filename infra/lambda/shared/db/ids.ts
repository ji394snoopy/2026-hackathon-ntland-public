// caseId minting. The plan calls for a self-minted primary key (nanoid / ulid style). We
// avoid pulling an extra dependency for this: a ULID-like, lexicographically-sortable id
// built from a millisecond timestamp prefix + crypto random suffix is plenty for our
// scale, sorts by creation time, and needs nothing beyond node:crypto (runtime built-in).

import { randomBytes } from "node:crypto";

// Crockford base32 (no I, L, O, U) — URL-safe, case-insensitive-friendly.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Mints a new caseId: a 10-char time component (48-bit ms timestamp, base32) followed by
 * a 16-char random component, prefixed "case_". Lexicographic order ≈ creation order.
 * Example: "case_01J9Z...".
 */
export function newCaseId(): string {
  const timeBytes = new Uint8Array(6);
  // Big-endian 48-bit millisecond timestamp. Date.now() exceeds 32 bits, so divide out
  // byte-by-byte rather than using bitwise ops (which would truncate to 32 bits).
  let t = Date.now();
  for (let i = 5; i >= 0; i--) {
    timeBytes[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  const rand = randomBytes(10);
  return `case_${encodeBase32(timeBytes)}${encodeBase32(rand)}`;
}
