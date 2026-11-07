// The Inkline record: the JSON that a symbol's PNG carries so that it can be
// edited again without loss. docs/file-format.md specifies it; this module
// writes it and checks it, treating every file as untrusted input.

import {
  PngError,
  firstDamaged,
  imageHeader,
  inflate,
  pngSignature,
  readChunks,
  slicer,
  writeChunks,
  type Chunk,
  type Pausing,
} from "./png.ts";

/** The format version this code writes, and the newest it reads. */
export const formatVersion = 1;

/** Coordinates and sizes are integers in sixteenths of a pixel. */
export const unitsPerPixel = 16;

/** The height of every symbol's image, in pixels. */
export const imageHeight = 192;

/**
 * Limits that bound what a crafted file can make a reader hold in memory. They
 * do not bound how long drawing it takes: see the format's security
 * considerations.
 */
export const limits = {
  /** The widest image, in pixels. */
  width: 4096,
  strokes: 10_000,
  /**
   * Points across all strokes. This bounds the size of the outlines a record
   * asks for, as a smooth stroke that doubles back at every point has 28
   * corners of outline for each one, from a few kilobytes of compressed text.
   * It does not bound the time to fill them, which can grow with the square of
   * a stroke's points. It is still minutes of unbroken drawing at the fastest
   * pointers' rate.
   */
  points: 250_000,
  /** Largest absolute coordinate, in units. */
  coordinate: 2 ** 24,
  /** Largest stroke diameter, in units. */
  strokeSize: 4096 * unitsPerPixel,
  /** Largest base image, in bytes. */
  baseBytes: 8 * 1024 * 1024,
  /** Largest base image width and height, in pixels. */
  baseSize: 4096,
  /** Longest record text, in bytes of UTF-8. */
  text: 16 * 1024 * 1024,
  /** Deepest nesting of objects and arrays in the record text. */
  depth: 16,
} as const;

export type Tool = "pen" | "eraser";

/**
 * Which way a stroke's ink is cut away at one of its ends: everything past
 * the horizontal line through that end point, in this direction, within the
 * brush's reach of it. `down` removes what lies below the line, as at a
 * baseline.
 */
export type Cut = "up" | "down";

/** The directions a stroke can be cut in, for checking a file. */
export const cuts: readonly Cut[] = ["up", "down"];

/** Where a stroke's ends are cut flat; an end not named keeps its round cap. */
export interface StrokeCuts {
  readonly start?: Cut;
  readonly end?: Cut;
}

/** What every stroke has. */
interface StrokeFields {
  readonly tool: Tool;
  /**
   * The points in drawing order, flattened: `x, y` per point, in units from
   * the image's top left corner.
   */
  readonly points: readonly number[];
}

/** A stroke drawn as the pointer went, smoothly, with round ends. */
export interface SmoothStroke extends StrokeFields {
  /** The stroke's diameter, in units. */
  readonly size: number;
  readonly kind?: never;
  /** The ends cut flat at a grid line, if any. */
  readonly cut?: StrokeCuts;
}

/**
 * Straight lines between the points, with sharp corners and square ends,
 * closed when the last point is the first.
 */
export interface PolygonStroke extends StrokeFields {
  /** The lines' width, in units. */
  readonly size: number;
  readonly kind: "polygon";
  readonly cut?: never;
}

/** The area the points enclose, the last point joined back to the first. */
export interface FillStroke extends StrokeFields {
  readonly kind: "fill";
  readonly size?: never;
  readonly cut?: never;
}

export type Stroke = SmoothStroke | PolygonStroke | FillStroke;

/** Imported pixels that strokes draw on and erase from. */
export interface BaseLayer {
  /** The left edge, in units from the image's left edge. */
  readonly x: number;
  /** The top edge, in units from the image's top edge. */
  readonly y: number;
  /** The width it is drawn at, in units. */
  readonly width: number;
  /** The height it is drawn at, in units. */
  readonly height: number;
  /** A PNG whose alpha channel is the ink. */
  readonly png: Uint8Array;
}

export interface InkRecord {
  readonly strokes: readonly Stroke[];
  readonly base?: BaseLayer;
}

export type ParseResult =
  | { readonly ok: true; readonly record: InkRecord }
  | { readonly ok: false; readonly detail: string };

class InvalidRecord extends Error {}

function fail(detail: string): never {
  throw new InvalidRecord(detail);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, name: string): Record<string, unknown> {
  return isObject(value) ? value : fail(`${name} is not an object`);
}

function integer(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : fail(`${name} is not an integer from ${String(min)} to ${String(max)}`);
}

function parseStroke(
  value: unknown,
  index: number,
  budget: { points: number },
): Stroke {
  const name = `strokes[${String(index)}]`;
  const stroke = object(value, name);
  const tool =
    stroke.tool === "pen" || stroke.tool === "eraser"
      ? stroke.tool
      : fail(`${name}.tool is not "pen" or "eraser"`);
  const raw = stroke.points;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length % 2 !== 0) {
    fail(`${name}.points is not a non-empty list of x, y points`);
  }
  budget.points -= raw.length / 2;
  if (budget.points < 0) fail(`more than ${String(limits.points)} points`);
  const points = raw.map((point: unknown) =>
    integer(point, `${name}.points`, -limits.coordinate, limits.coordinate),
  );
  const { kind } = stroke;
  if (kind === "fill") {
    if (points.length < 6) fail(`${name} fills fewer than three points`);
    if (stroke.size !== undefined) fail(`${name}.size is on a fill`);
    if (stroke.cut !== undefined) fail(`${name}.cut is on a fill`);
    return { tool, points, kind };
  }
  const size = integer(stroke.size, `${name}.size`, 1, limits.strokeSize);
  if (kind === "polygon") {
    if (stroke.cut !== undefined) fail(`${name}.cut is on a polygon`);
    return { tool, size, points, kind };
  }
  if (kind !== undefined) fail(`${name}.kind is not "polygon" or "fill"`);
  const cut = parseCuts(stroke.cut, `${name}.cut`);
  return { tool, size, points, ...(cut === undefined ? {} : { cut }) };
}

/** A stroke's cuts, or undefined when it has none. */
function parseCuts(value: unknown, name: string): StrokeCuts | undefined {
  if (value === undefined) return undefined;
  const fields = object(value, name);
  const end = (key: "start" | "end"): Cut | undefined => {
    const direction = fields[key];
    if (direction === undefined) return undefined;
    return (
      cuts.find((known) => known === direction) ??
      fail(`${name}.${key} is not "up" or "down"`)
    );
  };
  const start = end("start");
  const last = end("end");
  if (start === undefined && last === undefined) fail(`${name} is empty`);
  return {
    ...(start === undefined ? {} : { start }),
    ...(last === undefined ? {} : { end: last }),
  };
}

function fromBase64(text: string, name: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    fail(`${name} is not base64`);
  }
  // The bits padding leaves over are zero, so that bytes have one spelling.
  if (/(?:[^AQgw]==|[^AEIMQUYcgkosw048=]=)$/.test(text.slice(-3))) {
    fail(`${name} has padding bits set`);
  }
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The characters of base64, as bytes, and the one that pads it. */
const base64Letters = new TextEncoder().encode(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
);
const base64Padding = 0x3d;

/** How many bytes of base64 `length` bytes make. */
function base64Length(length: number): number {
  return Math.ceil(length / 3) * 4;
}

/** Writes `bytes` as base64 into `output`, from `start`. */
function writeBase64(
  bytes: Uint8Array,
  output: Uint8Array,
  start: number,
): void {
  const letter = (value: number): number => base64Letters[value & 63] ?? 0;
  const whole = bytes.length - (bytes.length % 3);
  let at = start;
  for (let from = 0; from < whole; from += 3) {
    const group =
      ((bytes[from] ?? 0) << 16) |
      ((bytes[from + 1] ?? 0) << 8) |
      (bytes[from + 2] ?? 0);
    output[at++] = letter(group >> 18);
    output[at++] = letter(group >> 12);
    output[at++] = letter(group >> 6);
    output[at++] = letter(group);
  }
  if (whole === bytes.length) return;
  const first = bytes[whole] ?? 0;
  const second = bytes[whole + 1];
  output[at++] = letter(first >> 2);
  output[at++] = letter((first << 4) | ((second ?? 0) >> 4));
  output[at++] = second === undefined ? base64Padding : letter(second << 2);
  output[at++] = base64Padding;
}

/** Bytes as base64, the way a record holds a base layer's PNG. */
export function toBase64(bytes: Uint8Array): string {
  const output = new Uint8Array(base64Length(bytes.length));
  writeBase64(bytes, output, 0);
  return new TextDecoder().decode(output);
}

/** How many bytes become base64 at a time, a whole number of groups. */
const base64SliceBytes = 3 * 16 * 1024;

/** {@link writeBase64} for a large PNG, in slices. */
async function writeBase64Sliced(
  bytes: Uint8Array,
  output: Uint8Array,
  start: number,
  { pause }: Pausing,
): Promise<void> {
  const breather = slicer(pause);
  for (let from = 0; from < bytes.length; from += base64SliceBytes) {
    writeBase64(
      bytes.subarray(from, from + base64SliceBytes),
      output,
      start + base64Length(from),
    );
    await breather();
  }
}

/** {@link toBase64} for a large PNG, in slices. */
export async function toBase64Sliced(
  bytes: Uint8Array,
  options: Pausing = {},
): Promise<string> {
  const output = new Uint8Array(base64Length(bytes.length));
  await writeBase64Sliced(bytes, output, 0, options);
  return new TextDecoder().decode(output);
}

/** The only chunks a base layer's PNG holds. */
const baseChunks = new Set(["IHDR", "IDAT", "IEND"]);

/**
 * Checks a base layer's PNG against the format's rules and limits. `checked`
 * says which chunks' CRCs to work out, as for {@link readChunks}, every chunk's
 * by default.
 */
function checkBasePng(
  png: Uint8Array,
  checked?: (type: string) => boolean,
): void {
  if (png.length > limits.baseBytes) fail("base.png is too large");
  let chunks: Chunk[];
  try {
    chunks = readChunks(png, checked);
  } catch (error) {
    if (!(error instanceof PngError)) throw error;
    fail(`base.png is not a valid PNG: ${error.message}`);
  }
  const { width, height, bitDepth, colorType, interlaced } =
    imageHeader(chunks);
  if (width > limits.baseSize || height > limits.baseSize) {
    fail(`base.png is larger than ${String(limits.baseSize)} pixels a side`);
  }
  if (bitDepth !== 8 || colorType !== 6 || interlaced) {
    fail("base.png is not 8-bit RGBA without interlacing");
  }
  const other = chunks.find((chunk) => !baseChunks.has(chunk.type));
  if (other !== undefined) fail(`base.png holds a ${other.type} chunk`);
  const wrong = chunks.find((chunk) => chunk.damaged === true);
  if (wrong !== undefined) fail(`base.png has a bad CRC in ${wrong.type}`);
  // Bytes after `IEND` would otherwise ride along in the record for ever.
  const end = chunks.reduce(
    (total, chunk) => total + 12 + chunk.data.length,
    pngSignature.length,
  );
  if (end !== png.length) fail("base.png holds bytes after its end");
}

/** A base layer's PNG from its base64 text, checked as a record's is. */
function basePng(text: unknown): Uint8Array {
  if (typeof text !== "string") fail("base.png is not a string");
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  if ((text.length / 4) * 3 - padding > limits.baseBytes) {
    fail("base.png is too large");
  }
  const png = fromBase64(text, "base.png");
  checkBasePng(png);
  return png;
}

/**
 * Why a PNG cannot be a base layer, as reading a record would refuse it, or
 * undefined when it can. `checked` says which chunks' CRCs to work out, every
 * chunk's by default.
 */
export function basePngProblem(
  png: Uint8Array,
  checked?: (type: string) => boolean,
): string | undefined {
  try {
    checkBasePng(png, checked);
    return undefined;
  } catch (error) {
    if (error instanceof InvalidRecord) return error.message;
    throw error;
  }
}

/** {@link basePngProblem} for a large PNG, working out its CRCs in slices. */
export async function slicedBasePngProblem(
  png: Uint8Array,
  options: Pausing = {},
): Promise<string | undefined> {
  const problem = basePngProblem(png, () => false);
  if (problem !== undefined) return problem;
  const chunks = readChunks(png, () => false);
  const damaged = await firstDamaged(png, chunks, options);
  return damaged === undefined
    ? undefined
    : `base.png has a bad CRC in ${damaged.type}`;
}

/** The highest filter type PNG defines for a row. */
const lastFilterType = 4;

/**
 * Why the image data of a base layer's PNG breaks the format, or undefined when
 * it does not, for a PNG {@link basePngProblem} passes. The format settles this
 * rather than a browser's decoder, as those differ: Chromium 120 draws rows that
 * are missing as empty, and Chromium 120 and 150 both pass a wrong Adler-32.
 * It costs what decoding the image does, at most 64 MiB of rows.
 */
export async function baseImageProblem(
  png: Uint8Array,
  { pause }: Pausing = {},
): Promise<string | undefined> {
  // That check has worked out the CRCs, and nothing here looks at them.
  const chunks = readChunks(png, () => false);
  const { width, height } = imageHeader(chunks);
  const parts = chunks.filter(({ type }) => type === "IDAT");
  const data = new Uint8Array(
    parts.reduce((total, { data: part }) => total + part.length, 0),
  );
  let filled = 0;
  for (const { data: part } of parts) {
    data.set(part, filled);
    filled += part.length;
  }
  const rowBytes = 1 + 4 * width;
  const size = height * rowBytes;
  let rows: Uint8Array;
  try {
    rows = await inflate(data, { limit: size, pause });
  } catch (error) {
    return `base.png's image data is not one whole stream: ${String(error)}`;
  }
  if (rows.length !== size) return "base.png's image data stops short";
  for (let row = 0; row < size; row += rowBytes) {
    if ((rows[row] ?? 0) > lastFilterType) {
      return "base.png has a row with an undefined filter type";
    }
  }
  return undefined;
}

/**
 * A base layer's PNG from base64 text, as a record holds it, or undefined
 * when reading a record would refuse it.
 */
export function readBasePng(text: unknown): Uint8Array | undefined {
  try {
    return basePng(text);
  } catch (error) {
    if (error instanceof InvalidRecord) return undefined;
    throw error;
  }
}

function parseBase(value: unknown): BaseLayer {
  const base = object(value, "base");
  const x = integer(base.x, "base.x", -limits.coordinate, limits.coordinate);
  const y = integer(base.y, "base.y", -limits.coordinate, limits.coordinate);
  const width = integer(base.width, "base.width", 1, limits.coordinate);
  const height = integer(base.height, "base.height", 1, limits.coordinate);
  return { x, y, width, height, png: basePng(base.png) };
}

/**
 * The text's length in UTF-8 bytes, counted up to just past `limit` without
 * encoding it. A string of more code units than `limit` is always longer,
 * since no code unit takes less than one byte.
 */
function utf8Length(text: string, limit: number): number {
  if (text.length > limit) return text.length;
  let bytes = 0;
  for (let index = 0; index < text.length && bytes <= limit; index++) {
    const unit = text.charCodeAt(index);
    // A surrogate is half of a four-byte character, or three bytes alone as
    // the replacement character that encoding would write.
    const next = text.charCodeAt(index + 1);
    if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      bytes += 4;
      index++;
    } else {
      bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
    }
  }
  return bytes;
}

/** Whether a code unit is white space, as JSON has it. */
function isSpace(unit: number): boolean {
  return unit === 0x20 || unit === 0x09 || unit === 0x0a || unit === 0x0d;
}

/** Whether a code unit is a decimal digit. */
function isDigit(unit: number): boolean {
  return unit >= 0x30 && unit <= 0x39;
}

/** Where the JSON string that opens at `start` closes. */
function stringEnd(text: string, start: number): number {
  let from = start + 1;
  for (;;) {
    const end = text.indexOf('"', from);
    if (end === -1) fail("not JSON");
    let slashes = 0;
    while (text[end - 1 - slashes] === "\\") slashes++;
    if (slashes % 2 === 0) return end;
    from = end + 1;
  }
}

/** Where the JSON number at `start` ends, when it is a plain integer. */
function integerEnd(text: string, start: number): number {
  const digits = text[start] === "-" ? start + 1 : start;
  let end = digits;
  while (isDigit(text.charCodeAt(end))) end++;
  const next = text[end];
  const fraction = next === "." || next === "e" || next === "E";
  // A leading zero is not JSON, and `-0` is not an integer's plain spelling.
  const zero = text[digits] === "0" && (end > digits + 1 || digits > start);
  if (fraction || zero) fail("a number is not an integer in plain digits");
  // Fifteen digits cannot pass it, so that ordinary numbers cost no parsing.
  if (
    end - digits > 15 &&
    Math.abs(Number(text.slice(start, end))) > Number.MAX_SAFE_INTEGER
  ) {
    fail("a number is too large");
  }
  return end;
}

/** A JSON string's text, with its escapes decoded. */
function decodedString(raw: string): string {
  try {
    return JSON.parse(raw) as string;
  } catch {
    fail("not JSON");
  }
}

/**
 * Checks what the format asks of the record's text beyond JSON, which parsing
 * it would not show or would let a crafted file get past: that objects and
 * arrays nest no deeper than the limit, that no object repeats a name, however
 * it is spelled, that no string holds half of a surrogate pair, and that every
 * number is an integer in plain digits that any reader can hold exactly.
 * Anything else wrong with the text is left for the parser to find.
 */
function checkText(text: string): void {
  /** An object's names so far, or undefined for an array, for each one open. */
  const open: (Set<string> | undefined)[] = [];
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '"') {
      const end = stringEnd(text, at);
      const raw = text.slice(at, end + 1);
      const value = raw.includes("\\") ? decodedString(raw) : raw.slice(1, -1);
      // With the `u` flag, a pair is one character, which this does not match.
      if (/[\uD800-\uDFFF]/u.test(value)) fail("a string is not valid Unicode");
      const names = open.at(-1);
      let next = end + 1;
      while (isSpace(text.charCodeAt(next))) next++;
      if (names !== undefined && text[next] === ":") {
        if (names.has(value)) fail(`the name ${raw} is repeated`);
        names.add(value);
      }
      at = end;
    } else if (char === "{" || char === "[") {
      open.push(char === "{" ? new Set() : undefined);
      if (open.length > limits.depth) {
        fail(`nested more than ${String(limits.depth)} deep`);
      }
    } else if (char === "}" || char === "]") {
      open.pop();
    } else if (char === "-" || isDigit(text.charCodeAt(at))) {
      at = integerEnd(text, at) - 1;
    }
  }
}

/**
 * Reads a record from its JSON text. Fields this version does not know are
 * ignored, and are not kept when the record is written again, as
 * docs/file-format.md says.
 */
export function parseRecord(text: string): ParseResult {
  try {
    if (utf8Length(text, limits.text) > limits.text) {
      fail("record text is too long");
    }
    checkText(text);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      fail("not JSON");
    }
    const record = object(json, "record");
    const rawStrokes = record.strokes;
    if (!Array.isArray(rawStrokes)) fail("strokes is not a list");
    if (rawStrokes.length > limits.strokes) {
      fail(`more than ${String(limits.strokes)} strokes`);
    }
    const budget = { points: limits.points };
    const strokes = rawStrokes.map((stroke: unknown, index) =>
      parseStroke(stroke, index, budget),
    );
    return {
      ok: true,
      record:
        record.base === undefined
          ? { strokes }
          : { strokes, base: parseBase(record.base) },
    };
  } catch (error) {
    if (error instanceof InvalidRecord) {
      return { ok: false, detail: error.message };
    }
    throw error;
  }
}

/**
 * Writes a record as JSON, with its fields in a fixed order so that the same
 * record always produces the same text.
 */
export function serializeRecord(record: InkRecord): string {
  return JSON.stringify(recordValue(record));
}

/**
 * The bytes of {@link serializeRecord}'s text, for a large base layer: its
 * base64 goes straight into them, in slices, rather than through one string,
 * each step of which would hold the page up. It is the last thing in the text
 * but the quote and braces that close it, and JSON escapes none of it.
 */
export async function serializedBytes(
  record: InkRecord,
  options: Pausing = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const { base } = record;
  const encoder = new TextEncoder();
  if (base === undefined) return encoder.encode(serializeRecord(record));
  const around = serializeRecord({
    ...record,
    base: { ...base, png: new Uint8Array(0) },
  });
  const end = around.length - '"}}'.length;
  const before = encoder.encode(around.slice(0, end));
  const after = encoder.encode(around.slice(end));
  const { png } = base;
  const length = base64Length(png.length);
  const output = new Uint8Array(before.length + length + after.length);
  output.set(before);
  output.set(after, before.length + length);
  await writeBase64Sliced(png, output, before.length, options);
  return output;
}

/**
 * The smallest PNG that {@link basePngProblem} passes, to stand for a base
 * layer's PNG in the text {@link recordProblem} reads.
 */
const standInPng = writeChunks([
  { type: "IHDR", data: Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0) },
  { type: "IDAT", data: new Uint8Array(0) },
  { type: "IEND", data: new Uint8Array(0) },
]);

/**
 * Why reading would refuse `record`, or undefined when it would not, for a
 * writer to check what it is about to write. Reading its text back would cost a
 * large base layer seconds of decoding, only to find the bytes it started with,
 * so the text read here holds a small PNG in that one's place, and the real one
 * gets the same checks as bytes, in slices. The text's length is the writer's
 * to check, as the text here is not the whole of it.
 */
export async function recordProblem(
  record: InkRecord,
  options: Pausing = {},
): Promise<string | undefined> {
  const { base } = record;
  const text = serializeRecord(
    base === undefined
      ? record
      : { ...record, base: { ...base, png: standInPng } },
  );
  const check = parseRecord(text);
  if (!check.ok) return check.detail;
  if (base === undefined) return undefined;
  return (
    (await slicedBasePngProblem(base.png, options)) ??
    baseImageProblem(base.png, options)
  );
}

/** A stroke's `cut` field as written, start first, or nothing without cuts. */
function cutsValue(cut: StrokeCuts | undefined): Record<string, unknown> {
  const start = cut?.start;
  const end = cut?.end;
  if (start === undefined && end === undefined) return {};
  return {
    cut: {
      ...(start === undefined ? {} : { start }),
      ...(end === undefined ? {} : { end }),
    },
  };
}

/** A stroke as written, with its fields in a fixed order. */
function strokeValue(stroke: Stroke): Record<string, unknown> {
  const { tool, points } = stroke;
  if (stroke.kind === "fill") return { tool, points, kind: stroke.kind };
  if (stroke.kind === "polygon") {
    return { tool, size: stroke.size, points, kind: stroke.kind };
  }
  return { tool, size: stroke.size, points, ...cutsValue(stroke.cut) };
}

/**
 * A record as the JSON value {@link serializeRecord} writes, for embedding in
 * other JSON, which {@link parseRecord} reads back once it is text again.
 */
export function recordValue(record: InkRecord): Record<string, unknown> {
  const { strokes, base } = record;
  return {
    strokes: strokes.map(strokeValue),
    ...(base === undefined
      ? {}
      : {
          base: {
            x: base.x,
            y: base.y,
            width: base.width,
            height: base.height,
            png: toBase64(base.png),
          },
        }),
  };
}
