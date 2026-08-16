// Report integrity — tamper-evidence for generated report HTML/PDF.
//
// WHY A HAND-WRITTEN SHA-256 LIVES HERE:
//   expo-crypto is NOT installed in this project and adding a dependency is
//   out of scope for this change. The implementation below is a compact,
//   standard FIPS 180-4 SHA-256 in pure JavaScript:
//     • no native module — works in Expo Go and in a dev build alike,
//     • runs on Hermes (plain typed arrays, no Node/WebCrypto globals),
//     • fully offline and synchronous — a roofer on a roof with no signal
//       still gets a hashed, verifiable document.
//   If expo-crypto is ever added, `sha256Hex` is the only function that has
//   to change; every caller goes through it.
//
// -----------------------------------------------------------------------------
// SELF-REFERENCE-SAFE EMBEDDING CONTRACT (an auditor will check this)
// -----------------------------------------------------------------------------
// A hash cannot cover the text that carries the hash — printing H(document)
// inside the document changes the document. So the contract is:
//
//   1. Render the complete report HTML WITHOUT any integrity footer. Call
//      that string `body`.
//   2. hash = SHA-256(body)  ← this is the published value.
//   3. Inject the integrity footer, delimited by the exact marker comments
//      INTEGRITY_START / INTEGRITY_END, immediately before `</body>`.
//
// Verification is therefore exactly reversible:
//
//   strip everything from INTEGRITY_START through INTEGRITY_END (inclusive,
//   including the newline that precedes the block) → that reproduces `body`
//   byte for byte → re-hash it → compare against the full hash carried in the
//   HTML comment inside the footer.
//
// `verifyReportHtml()` performs exactly those steps. Nothing else in the
// document may be altered between steps 1 and 3.
//
// SCOPE OF THE CLAIM (Drift #5 — never promise what does not exist):
// The hash stands ALONE and LOCALLY. There is no online verification service
// today — the Supabase project that would host a verification endpoint is
// administered from a different workspace and is not reachable from this
// repo's tooling — so the footer copy must never tell a reader to "verify at
// <url>". It states what the value is and how to re-compute it, and stops
// there. (docs/PRODUCT_SYNTHESIS.md: tamper-evidence is the Quadrant truth;
// the verification endpoint is tracked as deferred, not shipped.)

// -----------------------------------------------------------------------------
// SHA-256 (FIPS 180-4)
// -----------------------------------------------------------------------------

/** Round constants: first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Working schedule, allocated once — hashing is synchronous and single-threaded. */
const W = new Uint32Array(64);

function isLowSurrogate(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

/**
 * UTF-8 encode without TextEncoder (not guaranteed on Hermes/RN 0.74).
 *
 * Two passes — measure, then fill a pre-sized Uint8Array — so a multi-megabyte
 * report (photos inline as data URIs) never builds a giant intermediate
 * number[]. Unpaired surrogates are encoded as 3-byte sequences rather than
 * throwing; report HTML is well-formed text, and a hash must never fail on
 * odd input.
 */
function encodeUtf8(str: string): Uint8Array {
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) len += 1;
    else if (c < 0x800) len += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length && isLowSurrogate(str.charCodeAt(i + 1))) {
      len += 4;
      i++;
    } else len += 3;
  }

  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) {
      out[p++] = c;
    } else if (c < 0x800) {
      out[p++] = 0xc0 | (c >> 6);
      out[p++] = 0x80 | (c & 0x3f);
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length && isLowSurrogate(str.charCodeAt(i + 1))) {
      const cp = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(i + 1) - 0xdc00);
      out[p++] = 0xf0 | (cp >> 18);
      out[p++] = 0x80 | ((cp >> 12) & 0x3f);
      out[p++] = 0x80 | ((cp >> 6) & 0x3f);
      out[p++] = 0x80 | (cp & 0x3f);
      i++;
    } else {
      out[p++] = 0xe0 | (c >> 12);
      out[p++] = 0x80 | ((c >> 6) & 0x3f);
      out[p++] = 0x80 | (c & 0x3f);
    }
  }
  return out;
}

/** One 64-byte compression round, operating in place on the hash state H. */
function compress(H: Uint32Array, block: Uint8Array, offset: number): void {
  for (let t = 0; t < 16; t++) {
    const i = offset + t * 4;
    W[t] = ((block[i] << 24) | (block[i + 1] << 16) | (block[i + 2] << 8) | block[i + 3]) >>> 0;
  }
  for (let t = 16; t < 64; t++) {
    const w15 = W[t - 15];
    const w2 = W[t - 2];
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
  }

  let a = H[0];
  let b = H[1];
  let c = H[2];
  let d = H[3];
  let e = H[4];
  let f = H[5];
  let g = H[6];
  let h = H[7];

  for (let t = 0; t < 64; t++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (S0 + maj) >>> 0;

    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  H[0] = (H[0] + a) >>> 0;
  H[1] = (H[1] + b) >>> 0;
  H[2] = (H[2] + c) >>> 0;
  H[3] = (H[3] + d) >>> 0;
  H[4] = (H[4] + e) >>> 0;
  H[5] = (H[5] + f) >>> 0;
  H[6] = (H[6] + g) >>> 0;
  H[7] = (H[7] + h) >>> 0;
}

/**
 * SHA-256 of a UTF-8 string, returned as 64 lowercase hex characters.
 * Synchronous, allocation-light, and dependency-free.
 */
export function sha256Hex(message: string): string {
  const bytes = encodeUtf8(message);
  const len = bytes.length;

  // Initial hash values: first 32 bits of the fractional parts of the square
  // roots of the first 8 primes.
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  // Full blocks stream straight out of the input — no padded copy of a
  // multi-megabyte document.
  const fullBlocks = Math.floor(len / 64);
  for (let i = 0; i < fullBlocks; i++) compress(H, bytes, i * 64);

  // Tail: remaining bytes + 0x80 + zero padding + 64-bit big-endian bit length.
  const rem = len - fullBlocks * 64;
  const tail = new Uint8Array(rem + 9 > 64 ? 128 : 64);
  tail.set(bytes.subarray(fullBlocks * 64));
  tail[rem] = 0x80;

  const bitLenHi = Math.floor(len / 0x20000000); // (len * 8) / 2^32
  const bitLenLo = (len * 8) >>> 0;
  const end = tail.length;
  tail[end - 8] = (bitLenHi >>> 24) & 0xff;
  tail[end - 7] = (bitLenHi >>> 16) & 0xff;
  tail[end - 6] = (bitLenHi >>> 8) & 0xff;
  tail[end - 5] = bitLenHi & 0xff;
  tail[end - 4] = (bitLenLo >>> 24) & 0xff;
  tail[end - 3] = (bitLenLo >>> 16) & 0xff;
  tail[end - 2] = (bitLenLo >>> 8) & 0xff;
  tail[end - 1] = bitLenLo & 0xff;

  for (let i = 0; i < tail.length; i += 64) compress(H, tail, i);

  let hex = '';
  for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, '0');
  return hex;
}

// -----------------------------------------------------------------------------
// Report hashing + footer embedding
// -----------------------------------------------------------------------------

/** SHA-256 hex over the exact report HTML (footer-free — see the contract above). */
export function computeReportHash(html: string): string {
  return sha256Hex(html);
}

/** Number of hash characters shown to a human reader in the footer line. */
export const INTEGRITY_PREFIX_LENGTH = 16;

const INTEGRITY_START = '<!--ROOFWISE-INTEGRITY-START-->';
const INTEGRITY_END = '<!--ROOFWISE-INTEGRITY-END-->';
const HASH_COMMENT_PREFIX = '<!--ROOFWISE-INTEGRITY-SHA256:';

/**
 * Matches the injected block plus its trailing newline. Injection always adds
 * exactly `block + "\n"` at one position, so removing exactly that reproduces
 * the pre-injection HTML byte for byte.
 */
const INTEGRITY_BLOCK_RE = /<!--ROOFWISE-INTEGRITY-START-->[\s\S]*?<!--ROOFWISE-INTEGRITY-END-->\n?/;

/** Minimal escape — kept local so this module imports nothing (haagPdf imports it). */
function escAttr(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type IntegrityStamp = {
  /** The HTML with the integrity footer injected — this is what gets printed. */
  html: string;
  /** SHA-256 of the footer-free HTML. The published value. */
  hash: string;
};

/**
 * Hash the footer-free report HTML, then inject the footer carrying that hash.
 *
 * `generatedAt` is a pre-formatted display string (callers own date
 * formatting; this module stays dependency-free).
 *
 * The copy deliberately does NOT reference an online verification service —
 * none exists yet (see the scope note at the top of this file).
 */
export function stampReportIntegrity(html: string, generatedAt: string): IntegrityStamp {
  const hash = computeReportHash(html);
  const shown = hash.slice(0, INTEGRITY_PREFIX_LENGTH);
  const block =
    `${INTEGRITY_START}\n` +
    `${HASH_COMMENT_PREFIX}${hash}-->\n` +
    `<div class="integrity">\n` +
    `  <div class="integrity-line">Document integrity: SHA-256 ${escAttr(shown)}… · generated ${escAttr(generatedAt)}</div>\n` +
    `  <div class="integrity-note">This value is a SHA-256 checksum of this document's contents, ` +
    `computed at generation and printed here. Re-computing SHA-256 over this document with the ` +
    `integrity block removed reproduces it exactly; any alteration to any other part of the ` +
    `document produces a different value.</div>\n` +
    `</div>\n` +
    `${INTEGRITY_END}`;

  // Exactly `block + "\n"` is inserted at one position — nothing else in the
  // document moves or changes — so `stripIntegrityFooter` is its exact inverse.
  const anchor = html.lastIndexOf('</body>');
  const stamped =
    anchor === -1
      ? `${html}${block}\n`
      : `${html.slice(0, anchor)}${block}\n${html.slice(anchor)}`;
  return { html: stamped, hash };
}

/** Removes the integrity block, reproducing the exact HTML that was hashed. */
export function stripIntegrityFooter(html: string): string {
  return html.replace(INTEGRITY_BLOCK_RE, '');
}

export type IntegrityVerification = {
  /** An integrity block was found. */
  hasFooter: boolean;
  /** The full hash carried in the block's HTML comment. */
  embeddedHash: string | null;
  /** SHA-256 re-computed over the document with the block stripped. */
  computedHash: string | null;
  /** True only when both exist and match — the document is unaltered. */
  matches: boolean;
};

/**
 * Auditor path: strip the footer, re-hash, compare. This is the inverse of
 * `stampReportIntegrity` and the only supported verification today (local,
 * offline, no service call).
 */
export function verifyReportHtml(html: string): IntegrityVerification {
  const match = INTEGRITY_BLOCK_RE.exec(html);
  if (!match) return { hasFooter: false, embeddedHash: null, computedHash: null, matches: false };
  const hashMatch = /<!--ROOFWISE-INTEGRITY-SHA256:([0-9a-f]{64})-->/.exec(match[0]);
  const embeddedHash = hashMatch ? hashMatch[1] : null;
  const computedHash = computeReportHash(stripIntegrityFooter(html));
  return {
    hasFooter: true,
    embeddedHash,
    computedHash,
    matches: embeddedHash !== null && embeddedHash === computedHash,
  };
}
