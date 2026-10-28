// The Inkline record: the JSON that a symbol's PNG carries so that it can be
// edited again without loss. docs/file-format.md specifies it; this module
// writes it and checks it, treating every file as untrusted input.

import { PngError, imageHeader, readChunks, type ImageHeader } from "./png.ts";

/** The `format` value that marks a record as Inkline's. */
export const formatName = "inkline";

/** The record version this code writes, and the newest it reads. */
export const formatVersion = 1;

/** Coordinates and sizes are integers in sixteenths of a pixel. */
export const unitsPerPixel = 16;

/** The largest pressure value; pressure runs from 0 to this. */
export const maxPressure = 255;

/** Limits that keep a crafted file from exhausting memory or time. */
export const limits = {
  pxPerEm: { min: 16, max: 1024 },
  /** Image width and height, in pixels. */
  size: { min: 1, max: 8192 },
  strokes: 10_000,
  /** Points across all strokes. */
  points: 1_000_000,
  /** Largest absolute coordinate, in units. */
  coordinate: 2 ** 24,
  /** Largest stroke diameter, in units. */
  strokeSize: 4096 * unitsPerPixel,
  /** Largest base image, in bytes. */
  baseBytes: 8 * 1024 * 1024,
  /** Largest base image width and height, in pixels. */
  baseSize: 4096,
  baseScale: { min: 1 / 64, max: 64 },
  /** Longest record text, in bytes of UTF-8. */
  text: 16 * 1024 * 1024,
} as const;

export type Tool = "pen" | "eraser";

/**
 * Which way a stroke's ink is cut away at one of its ends: everything past
 * the line through that end point, across this direction, within the brush's
 * reach of it. `down` cuts along the horizontal line through the end and
 * removes what lies below it, as at a baseline.
 */
export type Cut = "up" | "down" | "left" | "right";

/** The directions a stroke can be cut in, for checking a file. */
export const cuts: readonly Cut[] = ["up", "down", "left", "right"];

/** Where a stroke's ends are cut flat; an end not named keeps its round cap. */
export interface StrokeCuts {
  readonly start?: Cut;
  readonly end?: Cut;
}

export interface Stroke {
  readonly tool: Tool;
  /** The stroke's diameter, in units. */
  readonly size: number;
  /** Whether the points carry pressure, which a pen records and a mouse does not. */
  readonly pressure: boolean;
  /**
   * The points in drawing order, flattened: `x, y` per point, or
   * `x, y, pressure` when {@link pressure} is true. Coordinates are in units
   * from the image's top left corner.
   */
  readonly points: readonly number[];
  /** The ends cut flat at a grid line, if any. */
  readonly cut?: StrokeCuts;
}

/** The image's geometry: the line box it maps to, in pixels. */
export interface Box {
  /** Pixels per em of the text the symbol sits in. */
  readonly pxPerEm: number;
  /** The image's width, in pixels, after cropping. */
  readonly width: number;
  /** The image's height, in pixels: the full line box. */
  readonly height: number;
  /** The text baseline, in pixels from the top. */
  readonly baseline: number;
}

/** Imported pixels that strokes draw on and erase from. */
export interface BaseLayer {
  /** The left edge, in units from the image's left edge. */
  readonly x: number;
  /** The top edge, in units from the image's top edge. */
  readonly y: number;
  /** How many image pixels one base pixel covers. */
  readonly scale: number;
  /** A PNG whose alpha channel is the ink. */
  readonly png: Uint8Array;
}

export interface InkRecord {
  readonly box: Box;
  readonly strokes: readonly Stroke[];
  readonly base?: BaseLayer;
}

export type ParseResult =
  | { readonly ok: true; readonly record: InkRecord }
  | {
      readonly ok: false;
      /**
       * `newer-version` when a later Inkline wrote the record, `invalid`
       * when it breaks the format.
       */
      readonly reason: "newer-version" | "invalid";
      readonly detail: string;
    };

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

function parseBox(value: unknown): Box {
  const box = object(value, "box");
  const pxPerEm = integer(
    box.pxPerEm,
    "box.pxPerEm",
    limits.pxPerEm.min,
    limits.pxPerEm.max,
  );
  const width = integer(
    box.width,
    "box.width",
    limits.size.min,
    limits.size.max,
  );
  const height = integer(
    box.height,
    "box.height",
    limits.size.min,
    limits.size.max,
  );
  const baseline = integer(box.baseline, "box.baseline", 0, height);
  return { pxPerEm, width, height, baseline };
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
  const size = integer(stroke.size, `${name}.size`, 1, limits.strokeSize);
  if (typeof stroke.pressure !== "boolean") {
    fail(`${name}.pressure is not a boolean`);
  }
  const pressure = stroke.pressure;
  const stride = pressure ? 3 : 2;
  const raw = stroke.points;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length % stride !== 0) {
    fail(
      `${name}.points is not a non-empty list of ${String(stride)}-number points`,
    );
  }
  budget.points -= raw.length / stride;
  if (budget.points < 0) fail(`more than ${String(limits.points)} points`);
  const points = raw.map((point: unknown, at) =>
    pressure && at % 3 === 2
      ? integer(point, `${name}.points`, 0, maxPressure)
      : integer(point, `${name}.points`, -limits.coordinate, limits.coordinate),
  );
  const cut = parseCuts(stroke.cut, `${name}.cut`);
  return cut === undefined
    ? { tool, size, pressure, points }
    : { tool, size, pressure, points, cut };
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
      fail(`${name}.${key} is not "up", "down", "left", or "right"`)
    );
  };
  const start = end("start");
  const last = end("end");
  if (start === undefined && last === undefined) return undefined;
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

/** Checks a base layer's PNG against the format's limits. */
function checkBasePng(png: Uint8Array): void {
  if (png.length > limits.baseBytes) fail("base.png is too large");
  let header: ImageHeader;
  try {
    header = imageHeader(readChunks(png));
  } catch (error) {
    if (!(error instanceof PngError)) throw error;
    fail(`base.png is not a valid PNG: ${error.message}`);
  }
  if (header.width > limits.baseSize || header.height > limits.baseSize) {
    fail(`base.png is larger than ${String(limits.baseSize)} pixels a side`);
  }
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
  const scale = base.scale;
  if (
    typeof scale !== "number" ||
    !Number.isFinite(scale) ||
    scale < limits.baseScale.min ||
    scale > limits.baseScale.max
  ) {
    fail("base.scale is out of range");
  }
  return { x, y, scale, png: basePng(base.png) };
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

/**
 * Reads a record from its JSON text. Fields this version does not know are
 * ignored, so that later versions can add optional ones; a higher `version`
 * means a change this version cannot read.
 */
export function parseRecord(text: string): ParseResult {
  try {
    if (utf8Length(text, limits.text) > limits.text) {
      fail("record text is too long");
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      fail("not JSON");
    }
    const record = object(json, "record");
    if (record.format !== formatName) fail("format is not inkline");
    const version = integer(
      record.version,
      "version",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    if (version > formatVersion) {
      return {
        ok: false,
        reason: "newer-version",
        detail: `version ${String(version)} is newer than ${String(formatVersion)}`,
      };
    }
    const box = parseBox(record.box);
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
          ? { box, strokes }
          : { box, strokes, base: parseBase(record.base) },
    };
  } catch (error) {
    if (error instanceof InvalidRecord) {
      return { ok: false, reason: "invalid", detail: error.message };
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

/**
 * A record as the JSON value {@link serializeRecord} writes, for embedding in
 * other JSON, which {@link parseRecord} reads back once it is text again.
 */
export function recordValue(record: InkRecord): Record<string, unknown> {
  const { box, strokes, base } = record;
  return {
    format: formatName,
    version: formatVersion,
    box: {
      pxPerEm: box.pxPerEm,
      width: box.width,
      height: box.height,
      baseline: box.baseline,
    },
    strokes: strokes.map(({ tool, size, pressure, points, cut }) => ({
      tool,
      size,
      pressure,
      points,
      ...cutsValue(cut),
    })),
    ...(base === undefined
      ? {}
      : {
          base: {
            x: base.x,
            y: base.y,
            scale: base.scale,
            png: toBase64(base.png),
          },
        }),
  };
}
