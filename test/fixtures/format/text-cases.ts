// Crafted text chunks, with what docs/file-format.md says a reader takes from
// each. The unit tests read them in Node.js, and test/e2e/specs/format.e2e.ts in
// Obsidian's Chromium, as decompression and text decoding are the browser's own.
// Ordinary decoders disagree on many of them, taking text from a stream with
// bytes after it, or from ill-formed UTF-8, so these pin the format's rule
// rather than what one library does. The text is synthetic.

import { deflateSync } from "node:zlib";
import type { Chunk } from "../../../src/format/png.ts";

/** A chunk, and the values a reader takes from it for `Inkline reading`. */
export interface TextCase {
  readonly name: string;
  readonly chunk: Chunk;
  readonly values: readonly string[];
}

const keyword = "Inkline reading";
const list = "TA\nDA";
const values = ["TA", "DA"];

function bytes(...parts: readonly (string | Uint8Array | number[])[]): Uint8Array {
  return Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === "string"
        ? [...new TextEncoder().encode(part)]
        : [...part],
    ),
  );
}

/** Latin-1 text as `tEXt` holds it: a byte for each code point. */
const latin1 = (text: string): Uint8Array =>
  Uint8Array.from(text, (char) => char.charCodeAt(0));

const tEXt = (text: Uint8Array | string): Chunk => ({
  type: "tEXt",
  data: bytes(keyword, [0], typeof text === "string" ? latin1(text) : text),
});

const zTXt = (stream: Uint8Array, method = 0): Chunk => ({
  type: "zTXt",
  data: bytes(keyword, [0, method], stream),
});

/** `iTXt` with the fields after the keyword's zero byte. */
const iTXt = (
  text: Uint8Array | string,
  { flag = 0, method = 0, tag = bytes(), translated = bytes() } = {},
): Chunk => ({
  type: "iTXt",
  data: bytes(keyword, [0, flag, method], tag, [0], translated, [0], text),
});

const stream = deflateSync(list);
const second = deflateSync("XX");
const noCheck = stream.subarray(0, -4);
const cutShort = stream.subarray(0, -6);
const badCheck = Uint8Array.from(stream);
badCheck[badCheck.length - 4] = (badCheck.at(-4) ?? 0) ^ 0xff;
// A zlib header that asks for a preset dictionary, and its dictionary's id.
const dictionary = bytes([0x78, 0x20, 0, 0, 0, 1], stream.subarray(2));

const compressedSuffixes: readonly (readonly [string, Uint8Array])[] = [
  ["a zero byte after", bytes(stream, [0])],
  ["junk after", bytes(stream, "JUNKJUNK")],
  ["a second stream after", bytes(stream, second)],
  ["no check value", noCheck],
  ["a cut short stream", cutShort],
  ["a wrong check value", badCheck],
  ["a preset dictionary", dictionary],
  ["nothing but a stream header", stream.subarray(0, 2)],
  ["no stream", bytes()],
  ["not a stream", bytes("TA")],
];

export const textCases: readonly TextCase[] = [
  { name: "tEXt", chunk: tEXt(list), values },
  { name: "zTXt", chunk: zTXt(stream), values },
  { name: "iTXt", chunk: iTXt(list), values },
  { name: "compressed iTXt", chunk: iTXt(stream, { flag: 1 }), values },

  ...compressedSuffixes.flatMap(([what, data]) => [
    { name: `zTXt with ${what}`, chunk: zTXt(data), values: [] },
    {
      name: `compressed iTXt with ${what}`,
      chunk: iTXt(data, { flag: 1 }),
      values: [],
    },
  ]),
  { name: "zTXt of method 1", chunk: zTXt(stream, 1), values: [] },
  {
    name: "zTXt that stops at its keyword",
    chunk: { type: "zTXt", data: bytes(keyword, [0]) },
    values: [],
  },
  {
    name: "compressed iTXt of method 1",
    chunk: iTXt(stream, { flag: 1, method: 1 }),
    values: [],
  },
  {
    name: "iTXt of an undefined method, which is ignored without compression",
    chunk: iTXt(list, { method: 7 }),
    values,
  },
  { name: "iTXt of flag 2", chunk: iTXt(list, { flag: 2 }), values: [] },
  {
    name: "iTXt of flag 1 with text that is not compressed",
    chunk: iTXt(list, { flag: 1 }),
    values: [],
  },

  {
    name: "a language tag that is no tag",
    chunk: iTXt(list, { tag: bytes("not a tag!") }),
    values,
  },
  {
    name: "a translated keyword that is not UTF-8",
    chunk: iTXt(list, { translated: bytes([0xff]) }),
    values,
  },
  {
    name: "iTXt that stops at its language tag",
    chunk: { type: "iTXt", data: bytes(keyword, [0, 0, 0], "en") },
    values: [],
  },
  {
    name: "iTXt that stops at its translated keyword",
    chunk: { type: "iTXt", data: bytes(keyword, [0, 0, 0, 0], "a") },
    values: [],
  },
  {
    name: "iTXt that stops at its flag",
    chunk: { type: "iTXt", data: bytes(keyword, [0, 0]) },
    values: [],
  },

  { name: "a byte order mark", chunk: iTXt(`\ufeff${list}`), values: [] },
  {
    name: "U+FEFF starting a later value, which is a character like any other",
    chunk: iTXt("TA\n\ufeffDA"),
    values: ["TA", "\ufeffDA"],
  },
  {
    name: "an ill-formed byte",
    chunk: iTXt(bytes("TA\n", [0xff], "DA")),
    values: [],
  },
  {
    name: "a surrogate in UTF-8",
    chunk: iTXt(bytes("TA\n", [0xed, 0xa0, 0x80], "DA")),
    values: [],
  },
  {
    name: "an overlong sequence",
    chunk: iTXt(bytes("TA\n", [0xc0, 0xaf], "DA")),
    values: [],
  },
  {
    name: "a sequence cut short at the end",
    chunk: iTXt(bytes("TA", [0xe3, 0x81])),
    values: [],
  },

  { name: "a line separator", chunk: iTXt("TA\u2028DA"), values: [] },
  { name: "a paragraph separator", chunk: iTXt("TA\u2029DA"), values: [] },
  { name: "a trailing line feed", chunk: iTXt(`${list}\n`), values: [] },
  { name: "a leading line feed", chunk: iTXt(`\n${list}`), values: [] },
  { name: "an empty line", chunk: iTXt("TA\n\nDA"), values: [] },
  { name: "no text", chunk: iTXt(""), values: [] },
  { name: "CR and LF", chunk: iTXt("TA\r\nDA"), values: [] },
  { name: "a tab", chunk: iTXt("TA\tDA"), values: [] },
  { name: "a delete", chunk: iTXt("TA\u007fDA"), values: [] },
  { name: "U+0085", chunk: iTXt("TA\u0085DA"), values: [] },
  { name: "U+009F", chunk: iTXt("TA\u009fDA"), values: [] },
  { name: "a zero in iTXt's text", chunk: iTXt("TA\0DA"), values: [] },
  { name: "a zero in tEXt's text", chunk: tEXt("TA\0DA"), values: [] },

  {
    name: "U+00A0, the first code point after the controls",
    chunk: tEXt("TA\u00a0DA"),
    values: ["TA\u00a0DA"],
  },
  { name: "a Latin-1 letter", chunk: tEXt("caf\u00e9"), values: ["caf\u00e9"] },
  // windows-1252, which is what the web's `latin1` label means, would make
  // these a printable euro sign and ellipsis.
  { name: "byte 0x80 in tEXt", chunk: tEXt("TA\u0080"), values: [] },
  { name: "byte 0x85 in tEXt", chunk: tEXt("TA\u0085"), values: [] },
  {
    name: "byte 0x85 in zTXt",
    chunk: zTXt(deflateSync(latin1("TA\u0085"))),
    values: [],
  },

  {
    name: "letters of other scripts, kept as they are",
    chunk: iTXt(" た \n𐎠\ne\u0301\n\u00e9"),
    values: [" た ", "𐎠", "e\u0301", "\u00e9"],
  },

  {
    name: "4,096 bytes",
    chunk: iTXt("x".repeat(4096)),
    values: ["x".repeat(4096)],
  },
  { name: "4,097 bytes", chunk: iTXt("x".repeat(4097)), values: [] },
  {
    name: "4,096 bytes, compressed",
    chunk: iTXt(deflateSync("x".repeat(4096)), { flag: 1 }),
    values: ["x".repeat(4096)],
  },
  {
    name: "4,097 bytes, compressed",
    chunk: iTXt(deflateSync("x".repeat(4097)), { flag: 1 }),
    values: [],
  },
  {
    name: "many times the limit, compressed",
    chunk: zTXt(deflateSync("x".repeat(1 << 20))),
    values: [],
  },
  {
    name: "Latin-1 text of 4,096 bytes in UTF-8",
    chunk: tEXt("\u00ff".repeat(2048)),
    values: ["\u00ff".repeat(2048)],
  },
  {
    name: "Latin-1 text of 4,098 bytes in UTF-8, though 2,049 in the file",
    chunk: tEXt("\u00ff".repeat(2049)),
    values: [],
  },
  {
    name: "compressed Latin-1 text of 4,098 bytes in UTF-8",
    chunk: zTXt(deflateSync(latin1("\u00ff".repeat(2049)))),
    values: [],
  },

  {
    name: "another keyword",
    chunk: { type: "tEXt", data: bytes("Inkline origin", [0], "TA") },
    values: [],
  },
  {
    name: "a keyword in another case",
    chunk: { type: "tEXt", data: bytes("inkline reading", [0], "TA") },
    values: [],
  },
  {
    name: "a keyword with a space after it",
    chunk: { type: "tEXt", data: bytes(`${keyword} `, [0], "TA") },
    values: [],
  },
  {
    name: "a keyword with no zero byte after it",
    chunk: { type: "tEXt", data: bytes(keyword) },
    values: [],
  },
  {
    name: "a keyword that runs on into what would be its text",
    chunk: { type: "tEXt", data: bytes(`${keyword}:TA`) },
    values: [],
  },
];

/**
 * Chunks a reader must pass over, then one it must use. A reader that lets a
 * stream's surplus through would take `TA`, or `CUT` from a shortened stream.
 */
export const passedOver: readonly Chunk[] = [
  zTXt(bytes(deflateSync("TA"), [0x42])),
  iTXt(bytes(deflateSync("TA"), deflateSync("XX")), { flag: 1 }),
  zTXt(deflateSync("CUT").subarray(0, -6)),
  iTXt("TA\n"),
];

/** The chunk that a reader takes, after {@link passedOver}. */
export const usedAfter: Chunk = iTXt("DA");
