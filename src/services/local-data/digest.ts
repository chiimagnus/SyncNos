import { LocalDataContractError, parseOrderedFrameDigest } from './contracts';

const DIGEST_COMPOSITION_DOMAIN = 'syncnos-local-data-ordered-frame-digest-v1';
const textEncoder = new TextEncoder();

export type DigestProvider = Readonly<{
  sha256: (bytes: Uint8Array) => Promise<string>;
}>;

export type OrderedFrameDigestEntry = Readonly<{
  byteLength: number;
  digest: string;
  sequence: number;
}>;

function invalidDigestInput(): never {
  throw new LocalDataContractError('INVALID_ARGUMENT');
}

function parseSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidDigestInput();
  return Number(value);
}

function parseByteLength(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidDigestInput();
  return Number(value);
}

function canonicalChainInput(previousDigest: string, entry: OrderedFrameDigestEntry): Uint8Array {
  return textEncoder.encode(
    `${DIGEST_COMPOSITION_DOMAIN}\n${previousDigest}\n${entry.sequence}\n${entry.byteLength}\n${entry.digest}\n`,
  );
}

export async function sha256Hex(provider: DigestProvider, bytes: Uint8Array): Promise<string> {
  if (!(bytes instanceof Uint8Array)) invalidDigestInput();
  return parseOrderedFrameDigest(await provider.sha256(bytes));
}

export class OrderedFrameDigestAccumulator {
  #appending = false;
  #finalized = false;
  #lastSequence: number | null = null;

  private constructor(
    private readonly provider: DigestProvider,
    private digest: string,
  ) {}

  static async create(provider: DigestProvider): Promise<OrderedFrameDigestAccumulator> {
    const initialDigest = await sha256Hex(provider, textEncoder.encode(`${DIGEST_COMPOSITION_DOMAIN}\n`));
    return new OrderedFrameDigestAccumulator(provider, initialDigest);
  }

  async append(entry: OrderedFrameDigestEntry): Promise<string> {
    if (this.#finalized || this.#appending) invalidDigestInput();
    this.#appending = true;
    try {
      const sequence = parseSequence(entry.sequence);
      const byteLength = parseByteLength(entry.byteLength);
      const digest = parseOrderedFrameDigest(entry.digest);
      if (this.#lastSequence !== null && sequence <= this.#lastSequence) invalidDigestInput();

      this.digest = await sha256Hex(this.provider, canonicalChainInput(this.digest, { sequence, byteLength, digest }));
      this.#lastSequence = sequence;
      return this.digest;
    } finally {
      this.#appending = false;
    }
  }

  async appendBytes(sequence: number, bytes: Uint8Array): Promise<string> {
    const digest = await sha256Hex(this.provider, bytes);
    return await this.append({ sequence, byteLength: bytes.byteLength, digest });
  }

  finalize(): string {
    if (this.#appending) invalidDigestInput();
    this.#finalized = true;
    return this.digest;
  }
}

export async function composeOrderedFrameDigest(
  provider: DigestProvider,
  entries: Iterable<OrderedFrameDigestEntry>,
): Promise<string> {
  const accumulator = await OrderedFrameDigestAccumulator.create(provider);
  for (const entry of entries) await accumulator.append(entry);
  return accumulator.finalize();
}
