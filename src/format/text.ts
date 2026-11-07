// What a person says about a symbol, its readings and translations, as
// docs/file-format.md's "Text about a symbol" defines them. They live in PNG's
// text chunks, apart from the record: neither reading nor changing them looks
// at the record, so both work on a file whose record cannot be used.

import {
  inflate,
  maxChunks,
  readChunks,
  spliceChunks,
  type Chunk,
} from "./png.ts";

/** What a symbol's text can say. */
export type TextField = "reading" | "translation";

/** Each field's values, the main one first, and none where none is recorded. */
export type SymbolText = Readonly<Record<TextField, readonly string[]>>;

/** The keyword that holds each field, compared byte for byte. */
export const textKeywords: Readonly<Record<TextField, string>> = {
  reading: "Inkline reading",
  translation: "Inkline translation",
};

/** The most that a chunk's text may hold, in bytes of UTF-8. */
export const maxTextBytes = 4096;

/** Thrown by {@link writeText} for a change it must not make. */
export class TextError extends Error {
  override name = "TextError";
}

/** Whether a chunk is one of PNG's text chunks, whatever it holds. */
export function isTextChunk({ type }: Chunk): boolean {
  return type === "tEXt" || type === "zTXt" || type === "iTXt";
}

/**
 * What is wrong with a field's values, or undefined when a file can hold them.
 * No values at all is not wrong: it is how a field is cleared.
 */
export function textProblem(values: readonly string[]): string | undefined {
  for (const value of values) {
    if (value === "") return "a value is empty";
    // Half of a surrogate pair is a `Cs` in a `u` pattern, and a whole pair is
    // not. Encoding one as UTF-8 would quietly change it.
    if (/\p{Cs}/u.test(value)) return "a value holds half of a surrogate pair";
    if (/[\p{Cc}\u2028\u2029]/u.test(value)) {
      return "a value holds a control character or a line break";
    }
  }
  const text = values.join("\n");
  if (text.startsWith("\ufeff"))
    return "the text starts with a byte order mark";
  return new TextEncoder().encode(text).length > maxTextBytes
    ? `the text is longer than ${String(maxTextBytes)} bytes`
    : undefined;
}

/** Whether a chunk says it holds the text of a keyword, as bytes. */
function holdsKeyword(chunk: Chunk, keyword: Uint8Array): boolean {
  return (
    isTextChunk(chunk) &&
    chunk.data[keyword.length] === 0 &&
    keyword.every((byte, index) => chunk.data[index] === byte)
  );
}

/** Where a chunk's text lies, from the byte that follows its keyword's zero. */
function textBytes(
  { type, data }: Chunk,
  start: number,
): { readonly bytes: Uint8Array; readonly compressed: boolean } | undefined {
  if (type === "tEXt") {
    return { bytes: data.subarray(start), compressed: false };
  }
  if (type === "zTXt") {
    return data[start] === 0
      ? { bytes: data.subarray(start + 1), compressed: true }
      : undefined;
  }
  const flag = data[start];
  const method = data[start + 1];
  if (method === undefined || flag === undefined || flag > 1) return undefined;
  if (flag === 1 && method !== 0) return undefined;
  // The language tag and the translated keyword: only their ends matter.
  const tagEnd = data.indexOf(0, start + 2);
  const end = tagEnd === -1 ? -1 : data.indexOf(0, tagEnd + 1);
  return end === -1
    ? undefined
    : { bytes: data.subarray(end + 1), compressed: flag === 1 };
}

/** The values of a chunk that holds a keyword's text, if it is usable. */
async function usableValues(
  chunk: Chunk,
  keyword: Uint8Array,
): Promise<readonly string[] | undefined> {
  if (chunk.damaged === true) return undefined;
  const found = textBytes(chunk, keyword.length + 1);
  if (found === undefined) return undefined;
  let text: string;
  try {
    // UTF-8 is never fewer bytes than Latin-1, so that text over the limit in
    // either is over it in UTF-8. `inflate` refuses a stream that is cut short,
    // has a wrong check value, or has anything after it.
    if (!found.compressed && found.bytes.length > maxTextBytes) {
      return undefined;
    }
    const bytes = found.compressed
      ? await inflate(found.bytes, { limit: maxTextBytes })
      : found.bytes;
    // Not `TextDecoder("latin1")`, which is really windows-1252, and turns
    // control characters into printable ones. `fatal` and `ignoreBOM` leave
    // ill-formed text and a byte order mark for the rules to refuse.
    text =
      chunk.type === "iTXt"
        ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            bytes,
          )
        : String.fromCharCode(...bytes);
  } catch {
    return undefined;
  }
  const values = text.split("\n");
  return textProblem(values) === undefined ? values : undefined;
}

function keywordBytes(field: TextField): Uint8Array {
  return new TextEncoder().encode(textKeywords[field]);
}

/**
 * What a file's chunks, from `readChunks`, say about its symbol: for each
 * field, the first usable chunk. A chunk that is not usable counts for nothing,
 * so this never fails, whatever the file's record is. Only the chunks of these
 * two keywords are decompressed.
 */
export async function readText(chunks: readonly Chunk[]): Promise<SymbolText> {
  const first = async (field: TextField): Promise<readonly string[]> => {
    const keyword = keywordBytes(field);
    for (const chunk of chunks) {
      if (!holdsKeyword(chunk, keyword)) continue;
      const values = await usableValues(chunk, keyword);
      if (values !== undefined) return values;
    }
    return [];
  };
  return {
    reading: await first("reading"),
    translation: await first("translation"),
  };
}

/** The chunk that holds a field's values, as a writer must write it. */
function textChunk(keyword: Uint8Array, values: readonly string[]): Chunk {
  const text = new TextEncoder().encode(values.join("\n"));
  // After the keyword's zero: the flag, the method, and an empty language tag
  // and translated keyword, each with its own zero.
  const data = new Uint8Array(keyword.length + 5 + text.length);
  data.set(keyword);
  data.set(text, keyword.length + 5);
  return { type: "iTXt", data };
}

/**
 * Changes one field of a file, leaving every other byte of it as it was, the
 * record's chunk among them, whatever that holds and whether or not its CRC is
 * right. The file's chunks that this field can use all give way to one holding
 * `values`, or to none when there are no values. One it cannot use may hold
 * what it cannot see, such as a list from a later revision of the format, so it
 * stays, behind the new one.
 *
 * Returns `bytes` itself when the field already reads as `values`, as nothing
 * then needs writing. To save a drawing and text together, pass this the file
 * that `writeInkFile` returns.
 *
 * Throws `PngError` when the bytes fail the format's check of a PNG's structure,
 * and {@link TextError} when {@link textProblem} finds a fault in `values`, or
 * the file would hold more chunks than `readChunks` takes.
 */
export async function writeText(
  bytes: Uint8Array,
  field: TextField,
  values: readonly string[],
): Promise<Uint8Array> {
  const problem = textProblem(values);
  if (problem !== undefined) throw new TextError(problem);
  const chunks = readChunks(bytes);
  const keyword = keywordBytes(field);
  const removed = new Set<Chunk>();
  let current: readonly string[] | undefined;
  for (const chunk of chunks) {
    if (!holdsKeyword(chunk, keyword)) continue;
    const found = await usableValues(chunk, keyword);
    if (found === undefined) continue;
    removed.add(chunk);
    current ??= found;
  }
  const unchanged =
    (current ?? []).length === values.length &&
    values.every((value, index) => value === current?.[index]);
  if (unchanged) return bytes;
  if (values.length === 0) return spliceChunks(bytes, chunks, removed);
  if (chunks.length - removed.size + 1 > maxChunks) {
    throw new TextError(`the file would hold over ${String(maxChunks)} chunks`);
  }
  // A kept chunk of this keyword may lie before the image data, and the new
  // one must come first.
  const before = chunks.find(
    (chunk) => chunk.type === "IDAT" || holdsKeyword(chunk, keyword),
  );
  if (before === undefined) throw new TextError("PNG has no image data");
  return spliceChunks(bytes, chunks, removed, {
    chunk: textChunk(keyword, values),
    before,
  });
}
