// The Inkline record: the JSON that a symbol's PNG carries so that it can be
// edited again without loss. docs/file-format.md specifies it; this module
// writes it and checks it, treating every file as untrusted input.

import {
  PngError,
  imageHeader,
  pngSignature,
  readChunks,
  type Chunk,
} from "./png.ts";

/** The format version this code writes, and the newest it reads. */
export const formatVersion = 1;

/** Coordinates and sizes are integers in sixteenths of a pixel. */
export const unitsPerPixel = 16;

/** The height of every symbol's image, in pixels. */
export const imageHeight = 192;

/** Limits that keep a crafted file from exhausting memory or time. */
export const limits = {
  /** The widest image, in pixels. */
  width: 4096,
  strokes: 10_000,
  /**
   * Points across all strokes. This is what bounds the work of drawing a
   * record, as a smooth stroke that doubles back at every point has 28 corners
   * of outline for each one, from a few kilobytes of compressed text. It is
   * still minutes of unbroken drawing at the fastest pointers' rate.
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
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Bytes as base64, the way a record holds a base layer's PNG. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunks keep each String.fromCharCode call within argument limits.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** The only chunks a base layer's PNG holds. */
const baseChunks = new Set(["IHDR", "IDAT", "IEND"]);

/** Checks a base layer's PNG against the format's rules and limits. */
function checkBasePng(png: Uint8Array): void {
  if (png.length > limits.baseBytes) fail("base.png is too large");
  let chunks: Chunk[];
  try {
    chunks = readChunks(png);
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
 * undefined when it can.
 */
export function basePngProblem(png: Uint8Array): string | undefined {
  try {
    checkBasePng(png);
    return undefined;
  } catch (error) {
    if (error instanceof InvalidRecord) return error.message;
    throw error;
  }
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

/** An object member's name, from its JSON string with its escapes. */
function decodedName(raw: string): string {
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
 * it is spelled, and that every number is an integer in plain digits that any
 * reader can hold exactly. Anything else wrong with the text is left for the
 * parser to find.
 */
function checkText(text: string): void {
  /** An object's names so far, or undefined for an array, for each one open. */
  const open: (Set<string> | undefined)[] = [];
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '"') {
      const end = stringEnd(text, at);
      const names = open.at(-1);
      let next = end + 1;
      while (isSpace(text.charCodeAt(next))) next++;
      if (names !== undefined && text[next] === ":") {
        const raw = text.slice(at, end + 1);
        const name = raw.includes("\\") ? decodedName(raw) : raw.slice(1, -1);
        if (names.has(name)) fail(`the name ${raw} is repeated`);
        names.add(name);
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
