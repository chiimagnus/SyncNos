const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

export class IncrementalSha256 {
  private state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private buffer = new Uint8Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;
  private finished = false;

  update(input: Uint8Array): this {
    if (this.finished) throw new Error('sha256_already_finished');
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.bytesHashed += bytes.byteLength;
    let offset = 0;

    if (this.bufferLength > 0) {
      const take = Math.min(64 - this.bufferLength, bytes.byteLength);
      this.buffer.set(bytes.subarray(0, take), this.bufferLength);
      this.bufferLength += take;
      offset += take;
      if (this.bufferLength === 64) {
        this.compress(this.buffer);
        this.bufferLength = 0;
      }
    }

    while (offset + 64 <= bytes.byteLength) {
      this.compress(bytes.subarray(offset, offset + 64));
      offset += 64;
    }

    if (offset < bytes.byteLength) {
      const remaining = bytes.subarray(offset);
      this.buffer.set(remaining, 0);
      this.bufferLength = remaining.byteLength;
    }
    return this;
  }

  digestHex(): string {
    if (this.finished) throw new Error('sha256_already_finished');
    this.finished = true;

    const finalBlock = new Uint8Array(128);
    finalBlock.set(this.buffer.subarray(0, this.bufferLength), 0);
    finalBlock[this.bufferLength] = 0x80;
    const used = this.bufferLength + 1;
    const total = used <= 56 ? 64 : 128;
    const bitLength = BigInt(this.bytesHashed) * 8n;
    for (let index = 0; index < 8; index += 1) {
      finalBlock[total - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
    }
    this.compress(finalBlock.subarray(0, 64));
    if (total === 128) this.compress(finalBlock.subarray(64, 128));

    return Array.from(this.state, (value) => value.toString(16).padStart(8, '0')).join('');
  }

  private compress(chunk: Uint8Array): void {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1) {
      const base = index * 4;
      words[index] =
        ((chunk[base]! << 24) | (chunk[base + 1]! << 16) | (chunk[base + 2]! << 8) | chunk[base + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const w15 = words[index - 15]!;
      const w2 = words[index - 2]!;
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }

    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[index]! + words[index]!) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.state[0] = (this.state[0]! + a) >>> 0;
    this.state[1] = (this.state[1]! + b) >>> 0;
    this.state[2] = (this.state[2]! + c) >>> 0;
    this.state[3] = (this.state[3]! + d) >>> 0;
    this.state[4] = (this.state[4]! + e) >>> 0;
    this.state[5] = (this.state[5]! + f) >>> 0;
    this.state[6] = (this.state[6]! + g) >>> 0;
    this.state[7] = (this.state[7]! + h) >>> 0;
  }
}
