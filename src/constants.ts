// Every tunable constant lives here. Several of these are candidates for
// becoming plugin settings later; keeping them in one module means promoting
// one to a setting only touches this file and the call sites that must switch
// to a settings read. Structural literals (CSS class names, DOM selectors)
// stay with the code that owns them instead.

/** Filename suffix that marks a PNG in the vault as an editable ink. */
export const INK_EXTENSION = ".ink.png";

/**
 * Default exported/stored resolution of an ink, in pixels per side of the
 * full square.
 *
 * @remarks
 * The whole square maps to the inline display height, so this is the source
 * resolution the browser downsamples to glyph size. The editor draws on a
 * larger surface ({@link SURFACE_SIZE}) and downsamples to this on save.
 *
 * @privateRemarks
 * Kept small on purpose: detail finer than the inline size is invisible
 * anyway.
 */
export const IMAGE_SIZE = 192;

/**
 * Lower bound of the stored ink resolution, in pixels per side.
 *
 * @remarks
 * The stored resolution is configurable (an advanced setting); below this
 * bound an ink loses all usable detail.
 */
export const MIN_IMAGE_SIZE = 96;

/**
 * Upper bound of the stored ink resolution, in pixels per side.
 *
 * @remarks
 * Must not exceed {@link SURFACE_SIZE}, so exporting is always a
 * downsample, never an upscale.
 */
export const MAX_IMAGE_SIZE = 576;

/**
 * The width steps a drawing can export at, as fractions of the square, in
 * ascending order and ending at the full square.
 *
 * @remarks
 * A drawing is cropped to the centered band of the smallest step that
 * contains all of its ink. The editor derives the crop guides, ink-extent
 * detection, and per-file export width from this table. Width is recovered
 * purely from the PNG aspect ratio (no metadata), so the steps must stay
 * distinguishable after export rounding — see `snapAspectToWidthStep` and
 * {@link WIDTH_STEP_EPSILON_RATIO}.
 */
export const WIDTH_STEPS = [0.4, 0.6, 0.8, 1] as const;

/** The last width step: the full, uncropped square. */
export const FULL_WIDTH_STEP = WIDTH_STEPS[WIDTH_STEPS.length - 1];

/**
 * Containment tolerance for snapping ink to a width step, as a fraction of
 * the square.
 *
 * @remarks
 * Absorbs the geometry noise of a save/reload cycle so a drawing saved at
 * step `w` always re-detects as step `w`.
 *
 * @privateRemarks
 * Two noise sources bound the value:
 * - detection scans whole pixel columns, so a band edge at a fractional
 *   x-position can mark the partially covered boundary column as ink
 *   (up to 1 px per side);
 * - resampling on export/reload can bleed antialiased ink about 1 px past
 *   the original extent (never past the drawn band).
 * That totals about 2 px per side on the drawing surface; 0.008 of the
 * 576 px surface is ~4.6 px, leaving headroom without visibly clipping ink
 * that gets snapped inward.
 */
export const WIDTH_STEP_EPSILON_RATIO = 0.008;

/**
 * Fixed backing resolution the editor draws on, in pixels per side,
 * independent of any file's stored size.
 *
 * @remarks
 * Strokes are downsampled to the file's export size on save, so this must
 * be at least {@link MAX_IMAGE_SIZE} for exporting to always be a
 * downsample, never an upscale.
 */
export const SURFACE_SIZE = 576;

/**
 * Reference on-screen canvas width, in CSS pixels.
 *
 * @remarks
 * Only used as the reference for the default zoom level (see
 * {@link DEFAULT_ZOOM}) and the modal header's fixed width in `styles.css`;
 * the canvas's actual on-screen size is driven by zoom instead.
 */
export const DISPLAY_WIDTH = 512;

/**
 * Minimum editor zoom level, in CSS pixels per stored image pixel.
 *
 * @privateRemarks
 * The range is deliberately a couple of named constants so it is trivial to
 * widen later.
 */
export const MIN_ZOOM = 1;

/** Maximum editor zoom level, in CSS pixels per stored image pixel. */
export const MAX_ZOOM = 6;

/**
 * The zoom level the editor opens at.
 *
 * @remarks
 * Chosen so an ink at the default stored size ({@link IMAGE_SIZE}) shows at
 * the reference canvas width ({@link DISPLAY_WIDTH}), clamped to the zoom
 * range.
 *
 * @privateRemarks
 * Inline clamp instead of clampZoom to keep constants free of function
 * imports.
 */
export const DEFAULT_ZOOM = Math.min(
  Math.max(Math.round(DISPLAY_WIDTH / IMAGE_SIZE), MIN_ZOOM),
  MAX_ZOOM,
);

/**
 * The inline size brushes are calibrated against: the whole square shown at
 * the reference display height (1.5em on a 16px font), in CSS pixels.
 *
 * @remarks
 * Brushes are sized by how many CSS pixels they occupy inline at this
 * height. The fixed surface plus downsample-on-export makes a stroke render
 * at the same inline pixels whatever the file's export resolution, so no
 * brush needs hard-coded surface pixels.
 */
export const REFERENCE_INLINE_PX = 24;

/**
 * The brush table: each entry pairs a toolbar button label with how many
 * CSS pixels the stroke occupies inline at the reference display height
 * ({@link REFERENCE_INLINE_PX}).
 */
export const BRUSH_SIZES = [
  { label: "S", inlinePx: 1 },
  { label: "M", inlinePx: 2 },
  { label: "L", inlinePx: 3 },
  { label: "XL", inlinePx: 4 },
] as const;

/** The brush selected when the editor opens: the "M" brush. */
export const DEFAULT_BRUSH_INLINE_PX = BRUSH_SIZES[1].inlinePx;

/** Maximum number of undo snapshots the editor history keeps. */
export const MAX_UNDO_STEPS = 50;

/**
 * Grayscale threshold below which a pixel counts as ink for width-step
 * detection (0–255, composited on white).
 *
 * @remarks
 * Must match how `flattenCanvasToGrayscale` flattens pixels so live
 * detection and post-flatten detection agree.
 */
export const INK_THRESHOLD = 250;

/**
 * Nominal cap height as a fraction of the text em.
 *
 * @remarks
 * The real ratio is measured from the default text font once; this value is
 * the fallback when measurement fails. Custom-font alignment is out of
 * scope.
 */
export const DEFAULT_CAP_HEIGHT_RATIO = 0.7;

/** Default inline display height of an ink, in em. */
export const DEFAULT_DISPLAY_HEIGHT_EM = 1.5;

/** Zero-padded width of auto-generated ink names ("001", "002", …). */
export const AUTO_NAME_PAD_WIDTH = 3;
