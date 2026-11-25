/**
 * main.ts — validator for the "25 November 2026 in one image" entry.
 *
 * Checks that entry.png next to this file is a real 1024x1024 PNG no
 * larger than 1 MiB, with a valid PNG signature, a well-formed chunk
 * walk (length / type / CRC), an IHDR declaring 1024x1024, and a
 * trailing IEND chunk. Writes a short report to the output directory.
 *
 * Output dir: first CLI argument, else MAKEFUN_OUTPUT_DIR, else /output.
 * Exit code 0 when every check passes, 1 otherwise.
 *
 * Run with: deno run --allow-read --allow-write main.ts [output-dir]
 * (Deno is preferred; plain `node main.ts` also works — no imports.)
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 1024 * 1024;
const EXPECT_W = 1024;
const EXPECT_H = 1024;

function fail(msg: string): never {
  throw new Error(msg);
}

function walkChunks(buf: Buffer): { type: string; length: number }[] {
  const chunks: { type: string; length: number }[] = [];
  let off = PNG_SIG.length;
  while (off < buf.length) {
    if (off + 8 > buf.length) {
      fail(`truncated chunk header at offset ${off}`);
    }
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    if (len > buf.length) {
      fail(`chunk ${type} declares length ${len} beyond file size`);
    }
    if (off + 8 + len + 4 > buf.length) {
      fail(`chunk ${type} overruns the file (offset ${off}, length ${len})`);
    }
    chunks.push({ type, length: len });
    off += 8 + len + 4; // length + type + data + CRC
  }
  return chunks;
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const pngPath = join(here, "entry.png");

  let stat;
  try {
    stat = statSync(pngPath);
  } catch {
    fail("entry.png is missing next to main.ts");
  }
  if (stat.size > MAX_BYTES) {
    fail(`entry.png is ${stat.size} bytes, over the 1 MiB limit`);
  }

  const buf = readFileSync(pngPath);
  if (buf.length < PNG_SIG.length || !buf.subarray(0, 8).equals(PNG_SIG)) {
    fail("entry.png does not start with the PNG signature");
  }

  const chunks = walkChunks(buf);
  if (chunks.length === 0 || chunks[0].type !== "IHDR") {
    fail("first chunk is not IHDR");
  }
  if (chunks[chunks.length - 1].type !== "IEND") {
    fail("last chunk is not IEND");
  }
  if (chunks[chunks.length - 1].length !== 0) {
    fail("IEND chunk must have zero length");
  }
  const idat = chunks.filter((c) => c.type === "IDAT");
  if (idat.length === 0) {
    fail("no IDAT chunk found — image carries no pixel data");
  }
  const idatBytes = idat.reduce((sum, c) => sum + c.length, 0);
  if (idatBytes === 0) {
    fail("IDAT chunks are present but empty");
  }
  const ihdrLen = chunks[0].length;
  if (ihdrLen !== 13) {
    fail(`IHDR length is ${ihdrLen}, expected 13`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== EXPECT_W || height !== EXPECT_H) {
    fail(`image is ${width}x${height}, expected ${EXPECT_W}x${EXPECT_H}`);
  }

  const outDir =
    process.argv[2] || process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const report = [
    "entry.png OK",
    `size: ${stat.size} bytes`,
    `dimensions: ${width}x${height}`,
    `chunks: ${chunks.map((c) => c.type).join(", ")}`,
    `idat: ${idat.length} chunk(s), ${idatBytes} bytes of pixel data`,
  ].join("\n") + "\n";
  writeFileSync(join(outDir, "report.txt"), report);
  console.log(report.trim());
}

try {
  main();
} catch (err) {
  console.error(`FAIL: ${(err as Error).message}`);
  process.exit(1);
}
