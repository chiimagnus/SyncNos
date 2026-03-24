declare module '@gorhill/ubo-core/js/s14e-serializer.js' {
  export function serialize(value: unknown, options?: { compress?: boolean }): string;
  export function deserialize(value: string): unknown;
}

declare module '@gorhill/ubo-core/js/static-filtering-parser.js' {
  export class AstFilterParser {
    constructor(options?: { maxTokenLength?: number });
    parse(line: string): void;
    isFilter(): boolean;
    isNetworkFilter(): boolean;
  }
}

declare module '@gorhill/ubo-core/js/filtering-context.js' {
  export class FilteringContext {
    redirectURL?: string;
    fromDetails(details: { originURL: string; url: string; type: string }): this;
  }
}

declare module '@gorhill/ubo-core/js/static-filtering-io.js' {
  export class CompiledListReader {
    constructor(compiled: string);
  }
  export class CompiledListWriter {
    properties: Map<string, string>;
    toString(): string;
  }
}

declare module '@gorhill/ubo-core/js/static-net-filtering.js' {
  const snfe: {
    MAX_TOKEN_LENGTH: number;
    reset(): void;
    createCompiler(): unknown;
    fromCompiled(reader: unknown): void;
    freeze(): void;
    optimize(): void;
    filterQuery(fctx: unknown): unknown;
    serialize(): unknown;
    unserialize(selfie: unknown): boolean;
  };
  export default snfe;
}

declare module '@gorhill/ubo-core/js/text-utils.js' {
  export class LineIterator {
    constructor(text: string);
    eot(): boolean;
    next(): string;
    peek(count: number): string;
  }
}

declare module '@gorhill/ubo-core/lib/publicsuffixlist/publicsuffixlist.js' {
  const publicSuffixList: {
    fromSelfie(selfie: unknown): void;
  };
  export default publicSuffixList;
}

declare module '@gorhill/ubo-core/build/publicsuffixlist.json' {
  const selfie: unknown;
  export default selfie;
}
