import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const zipUtils = require("../../src/export/local/zip-utils.js");

describe("zip-utils", () => {
  it("creates a valid zip blob for multiple files", async () => {
    const blob = await zipUtils.createZipBlob([
      { name: "a.txt", data: "hello" },
      { name: "b.md", data: "# title" }
    ]);

    expect(blob).toBeTruthy();
    expect(blob.type).toBe("application/zip");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    // ZIP local file header signature: PK\x03\x04
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // End of central directory signature: PK\x05\x06 (no comment, fixed footer size)
    expect(Array.from(bytes.slice(bytes.length - 22, bytes.length - 18))).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});
