// SHA-256 (FIPS 180-4) of attachment bytes (data-model.md 6.4, R5). Written out here because the
// reader and the import are synchronous pure functions, and the platform's digest is asynchronous.
// It only names content; nothing secret depends on it.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const HEX = "0123456789abcdef";

/** Mix one 64-byte block, starting at `offset` of `data`, into `state`. `w` is scratch space of 64 words. */
function compress(state: Uint32Array, data: Uint8Array, offset: number, w: Uint32Array): void {
  for (let i = 0; i < 16; i++) {
    const at = offset + i * 4;
    w[i] =
      ((data[at] ?? 0) << 24) |
      ((data[at + 1] ?? 0) << 16) |
      ((data[at + 2] ?? 0) << 8) |
      (data[at + 3] ?? 0);
  }
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15] ?? 0;
    const y = w[i - 2] ?? 0;
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) | 0;
  }
  let a = state[0] ?? 0;
  let b = state[1] ?? 0;
  let c = state[2] ?? 0;
  let d = state[3] ?? 0;
  let e = state[4] ?? 0;
  let f = state[5] ?? 0;
  let g = state[6] ?? 0;
  let h = state[7] ?? 0;
  for (let i = 0; i < 64; i++) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const choice = (e & f) ^ (~e & g);
    const t1 = (h + s1 + choice + (K[i] ?? 0) + (w[i] ?? 0)) | 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (s0 + majority) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  state[0] = ((state[0] ?? 0) + a) | 0;
  state[1] = ((state[1] ?? 0) + b) | 0;
  state[2] = ((state[2] ?? 0) + c) | 0;
  state[3] = ((state[3] ?? 0) + d) | 0;
  state[4] = ((state[4] ?? 0) + e) | 0;
  state[5] = ((state[5] ?? 0) + f) | 0;
  state[6] = ((state[6] ?? 0) + g) | 0;
  state[7] = ((state[7] ?? 0) + h) | 0;
}

/** SHA-256 of the bytes as 64 lower-case hexadecimal characters: the form of `sha256` in the format. */
export function sha256Hex(bytes: Uint8Array): string {
  const state = new Uint32Array(INITIAL);
  const w = new Uint32Array(64);
  const whole = bytes.length - (bytes.length % 64);
  for (let offset = 0; offset < whole; offset += 64) compress(state, bytes, offset, w);

  // The rest, the 0x80 marker and the bit length fill one more block, or two.
  const rest = bytes.length - whole;
  const tail = new Uint8Array(rest < 56 ? 64 : 128);
  tail.set(bytes.subarray(whole));
  tail[rest] = 0x80;
  const bits = bytes.length * 8;
  const high = Math.floor(bits / 0x1_0000_0000);
  const low = bits >>> 0;
  const end = tail.length;
  tail[end - 8] = (high >>> 24) & 255;
  tail[end - 7] = (high >>> 16) & 255;
  tail[end - 6] = (high >>> 8) & 255;
  tail[end - 5] = high & 255;
  tail[end - 4] = (low >>> 24) & 255;
  tail[end - 3] = (low >>> 16) & 255;
  tail[end - 2] = (low >>> 8) & 255;
  tail[end - 1] = low & 255;
  for (let offset = 0; offset < end; offset += 64) compress(state, tail, offset, w);

  let hex = "";
  for (let i = 0; i < 8; i++) {
    const word = state[i] ?? 0;
    for (let shift = 28; shift >= 0; shift -= 4) hex += HEX.charAt((word >>> shift) & 15);
  }
  return hex;
}
