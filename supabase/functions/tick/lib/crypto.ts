// Cross-runtime token encryption.
//
// Runs unchanged in the Next/Netlify runtime AND in the Supabase Edge Function
// (Deno): both expose Web Crypto via globalThis.crypto. We keep the EXACT wire
// format and key derivation of the previous node:crypto implementation
// (scrypt(secret, "account-manager-salt", 32) + AES-256-GCM, payload encoded as
// "iv:tag:enc" with each part base64), so ciphertext written by either runtime
// decrypts in the other.
//
// Web Crypto has no native scrypt, so it is implemented below in portable JS.
// AES-GCM appends the 16-byte auth tag to the ciphertext; we split it back out
// to preserve the legacy iv:tag:enc layout.

const SALT = "account-manager-salt";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16; // AES-GCM tag length in bytes (128 bits)

function getSecret(): string {
  const secret = globalThis.process?.env?.ENCRYPTION_KEY ?? Deno_env("ENCRYPTION_KEY");
  if (!secret) throw new Error("ENCRYPTION_KEY is not set");
  return secret;
}

// Read an env var from Deno when process.env is unavailable (Edge Function).
function Deno_env(name: string): string | undefined {
  const d = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
  return d?.env?.get(name);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      // scrypt(N=16384, r=8, p=1) — node's scryptSync defaults — to stay
      // wire-compatible with previously stored ciphertext.
      const raw = scrypt(enc.encode(getSecret()), enc.encode(SALT), 16384, 8, 1, KEY_LEN);
      return crypto.subtle.importKey("raw", buf(raw), { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ]);
    })();
  }
  return keyPromise;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Copy into a fresh ArrayBuffer-backed view. crypto.subtle's BufferSource type
// rejects the generic Uint8Array<ArrayBufferLike> our helpers/TextEncoder yield.
function buf(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
}

export async function encrypt(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_LEN)));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buf(enc.encode(plain))),
  );
  // Web Crypto returns ciphertext||tag; split the trailing tag back out so the
  // stored payload matches the legacy iv:tag:enc layout.
  const ct = sealed.subarray(0, sealed.length - TAG_LEN);
  const tag = sealed.subarray(sealed.length - TAG_LEN);
  return [toBase64(iv), toBase64(tag), toBase64(ct)].join(":");
}

export async function decrypt(payload: string): Promise<string> {
  const key = await getKey();
  const [ivB64, tagB64, encB64] = payload.split(":");
  const iv = buf(fromBase64(ivB64));
  const tag = fromBase64(tagB64);
  const ct = fromBase64(encB64);
  // Re-join ciphertext||tag for Web Crypto, which expects the tag appended.
  const sealed = new Uint8Array(new ArrayBuffer(ct.length + tag.length));
  sealed.set(ct, 0);
  sealed.set(tag, ct.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed);
  return dec.decode(plain);
}

// ---------------------------------------------------------------------------
// Portable scrypt (RFC 7914). Self-contained so it works in both Node and Deno
// without a native scrypt or an extra dependency. Parameters are fixed by the
// caller (N=16384, r=8, p=1, dkLen=32) to match node:crypto's scryptSync.
// ---------------------------------------------------------------------------

function scrypt(
  password: Uint8Array,
  salt: Uint8Array,
  N: number,
  r: number,
  p: number,
  dkLen: number,
): Uint8Array {
  const blockSize = 128 * r;
  const B = pbkdf2Sha256(password, salt, 1, p * blockSize);
  const XY = new Uint8Array(256 * r);
  const V = new Uint8Array(128 * r * N);
  for (let i = 0; i < p; i++) {
    smix(B.subarray(i * blockSize, (i + 1) * blockSize), r, N, V, XY);
  }
  return pbkdf2Sha256(password, B, 1, dkLen);
}

function smix(B: Uint8Array, r: number, N: number, V: Uint8Array, XY: Uint8Array): void {
  const blockSize = 128 * r;
  const X = XY.subarray(0, blockSize);
  const Y = XY.subarray(blockSize, 2 * blockSize);
  X.set(B);

  for (let i = 0; i < N; i++) {
    V.set(X, i * blockSize);
    blockMix(X, Y, r); // X -> Y
    X.set(Y);
  }
  for (let i = 0; i < N; i++) {
    const j = integerify(X, r) & (N - 1);
    for (let k = 0; k < blockSize; k++) X[k] ^= V[j * blockSize + k];
    blockMix(X, Y, r); // X -> Y
    X.set(Y);
  }
  B.set(X);
}

// blockMix per RFC 7914: reads `inp` (128*r bytes), writes result into `out`.
function blockMix(inp: Uint8Array, out: Uint8Array, r: number): void {
  const X = new Uint8Array(64);
  X.set(inp.subarray((2 * r - 1) * 64, 2 * r * 64));
  for (let i = 0; i < 2 * r; i++) {
    for (let k = 0; k < 64; k++) X[k] ^= inp[i * 64 + k];
    salsa20_8(X);
    // Even blocks -> first half of out, odd blocks -> second half.
    const dest = (i % 2 === 0 ? i / 2 : r + (i - 1) / 2) * 64;
    out.set(X, dest);
  }
}

function integerify(B: Uint8Array, r: number): number {
  const off = (2 * r - 1) * 64;
  return (
    (B[off] | (B[off + 1] << 8) | (B[off + 2] << 16) | (B[off + 3] << 24)) >>> 0
  );
}

function salsa20_8(B: Uint8Array): void {
  const x = new Uint32Array(16);
  for (let i = 0; i < 16; i++) {
    x[i] =
      (B[i * 4] |
        (B[i * 4 + 1] << 8) |
        (B[i * 4 + 2] << 16) |
        (B[i * 4 + 3] << 24)) >>>
      0;
  }
  const b = x.slice();
  const R = (a: number, n: number) => ((a << n) | (a >>> (32 - n))) >>> 0;
  for (let i = 0; i < 8; i += 2) {
    x[4] ^= R((x[0] + x[12]) >>> 0, 7);
    x[8] ^= R((x[4] + x[0]) >>> 0, 9);
    x[12] ^= R((x[8] + x[4]) >>> 0, 13);
    x[0] ^= R((x[12] + x[8]) >>> 0, 18);
    x[9] ^= R((x[5] + x[1]) >>> 0, 7);
    x[13] ^= R((x[9] + x[5]) >>> 0, 9);
    x[1] ^= R((x[13] + x[9]) >>> 0, 13);
    x[5] ^= R((x[1] + x[13]) >>> 0, 18);
    x[14] ^= R((x[10] + x[6]) >>> 0, 7);
    x[2] ^= R((x[14] + x[10]) >>> 0, 9);
    x[6] ^= R((x[2] + x[14]) >>> 0, 13);
    x[10] ^= R((x[6] + x[2]) >>> 0, 18);
    x[3] ^= R((x[15] + x[11]) >>> 0, 7);
    x[7] ^= R((x[3] + x[15]) >>> 0, 9);
    x[11] ^= R((x[7] + x[3]) >>> 0, 13);
    x[15] ^= R((x[11] + x[7]) >>> 0, 18);
    x[1] ^= R((x[0] + x[3]) >>> 0, 7);
    x[2] ^= R((x[1] + x[0]) >>> 0, 9);
    x[3] ^= R((x[2] + x[1]) >>> 0, 13);
    x[0] ^= R((x[3] + x[2]) >>> 0, 18);
    x[6] ^= R((x[5] + x[4]) >>> 0, 7);
    x[7] ^= R((x[6] + x[5]) >>> 0, 9);
    x[4] ^= R((x[7] + x[6]) >>> 0, 13);
    x[5] ^= R((x[4] + x[7]) >>> 0, 18);
    x[11] ^= R((x[10] + x[9]) >>> 0, 7);
    x[8] ^= R((x[11] + x[10]) >>> 0, 9);
    x[9] ^= R((x[8] + x[11]) >>> 0, 13);
    x[10] ^= R((x[9] + x[8]) >>> 0, 18);
    x[12] ^= R((x[15] + x[14]) >>> 0, 7);
    x[13] ^= R((x[12] + x[15]) >>> 0, 9);
    x[14] ^= R((x[13] + x[12]) >>> 0, 13);
    x[15] ^= R((x[14] + x[13]) >>> 0, 18);
  }
  for (let i = 0; i < 16; i++) {
    const v = (x[i] + b[i]) >>> 0;
    B[i * 4] = v & 0xff;
    B[i * 4 + 1] = (v >>> 8) & 0xff;
    B[i * 4 + 2] = (v >>> 16) & 0xff;
    B[i * 4 + 3] = (v >>> 24) & 0xff;
  }
}

// PBKDF2-HMAC-SHA256 (RFC 8018) — scrypt's outer KDF. Pure JS so it stays
// runtime-agnostic and synchronous within scrypt.
function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Uint8Array {
  const hLen = 32;
  const blocks = Math.ceil(dkLen / hLen);
  const out = new Uint8Array(blocks * hLen);
  const block = new Uint8Array(salt.length + 4);
  block.set(salt);
  for (let i = 1; i <= blocks; i++) {
    block[salt.length] = (i >>> 24) & 0xff;
    block[salt.length + 1] = (i >>> 16) & 0xff;
    block[salt.length + 2] = (i >>> 8) & 0xff;
    block[salt.length + 3] = i & 0xff;
    let u = hmacSha256(password, block);
    const t = u.slice();
    for (let j = 1; j < iterations; j++) {
      u = hmacSha256(password, u);
      for (let k = 0; k < hLen; k++) t[k] ^= u[k];
    }
    out.set(t, (i - 1) * hLen);
  }
  return out.subarray(0, dkLen);
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let k = key;
  if (k.length > blockSize) k = sha256(k);
  const padded = new Uint8Array(blockSize);
  padded.set(k);
  const oKey = new Uint8Array(blockSize);
  const iKey = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKey[i] = padded[i] ^ 0x5c;
    iKey[i] = padded[i] ^ 0x36;
  }
  const inner = sha256(concat(iKey, message));
  return sha256(concat(oKey, inner));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

// SHA-256 (FIPS 180-4), synchronous pure JS.
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(msg: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const l = msg.length;
  const bitLen = l * 8;
  const padLen = ((l + 8) >> 6) + 1;
  const padded = new Uint8Array(padLen * 64);
  padded.set(msg);
  padded[l] = 0x80;
  // 64-bit big-endian length; messages here are far below 2^32 bytes.
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  const R = (a: number, n: number) => ((a >>> n) | (a << (32 - n))) >>> 0;
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = R(w[i - 15], 7) ^ R(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = R(w[i - 2], 17) ^ R(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3];
    let e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = R(e, 6) ^ R(e, 11) ^ R(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = R(a, 2) ^ R(a, 13) ^ R(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
  return out;
}
