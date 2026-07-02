// Every tunable constant lives here. Several of these are candidates for
// becoming plugin settings later; keeping them in one module means promoting
// one to a setting only touches this file and the call sites that must switch
// to a settings read. Structural literals (CSS class names, DOM selectors)
// stay with the code that owns them instead.

/** Filename suffix that marks a PNG in the vault as an editable ink. */
export const INK_EXTENSION = ".ink.png";

// Exported/stored resolution of an ink. The whole square maps to the inline
// display height, so this is the source the browser downsamples to glyph size;
// it is kept small on purpose because detail finer than the inline size is
// invisible anyway. The editor draws on a larger surface (SURFACE_SIZE) and
// downsamples to this on save.
export const IMAGE_SIZE = 192;
// The stored resolution is configurable (an advanced setting). Clamp to a sane
// range: too small loses all detail, and the upper bound must not exceed
// SURFACE_SIZE so exporting is always a downsample, never an upscale.
export const MIN_IMAGE_SIZE = 96;
export const MAX_IMAGE_SIZE = 576;

// Width steps a drawing can export at, as fractions of the square. A drawing
// is cropped to the centered band of the smallest step that contains all of
// its ink; the last step is the full square. The editor derives the crop
// guides, ink-extent detection, and per-file export width from this table.
// Width is recovered purely from the PNG aspect ratio (no metadata), so the
// steps must stay distinguishable after export rounding — see
// snapAspectToWidthStep and WIDTH_STEP_EPSILON_RATIO.
export const WIDTH_STEPS = [0.4, 0.6, 0.8, 1] as const;
export const FULL_WIDTH_STEP = WIDTH_STEPS[WIDTH_STEPS.length - 1];

// Containment tolerance for snapping ink to a width step, as a fraction of the
// square. It absorbs the geometry noise of a save/reload cycle so a drawing
// saved at step w always re-detects as step w:
// - detection scans whole pixel columns, so a band edge at a fractional
//   x-position can mark the partially covered boundary column as ink
//   (up to 1 px per side);
// - resampling on export/reload can bleed antialiased ink about 1 px past the
//   original extent (never past the drawn band).
// That totals about 2 px per side on the drawing surface; 0.008 of the 576 px
// surface is ~4.6 px, leaving headroom without visibly clipping ink that gets
// snapped inward.
export const WIDTH_STEP_EPSILON_RATIO = 0.008;

// Fixed backing resolution the editor draws on, independent of any file's
// stored size. Strokes are downsampled to the file's export size on save, so
// this must be >= MAX_IMAGE_SIZE for exporting to always be a downsample,
// never an upscale. DISPLAY_WIDTH is only used as the reference for the
// default zoom level (see DEFAULT_ZOOM below) and the modal header's fixed
// width in styles.css; the canvas's actual on-screen size is driven by zoom
// instead.
export const SURFACE_SIZE = 576;
export const DISPLAY_WIDTH = 512;

// The drawing area is shown at `zoomLevel` CSS pixels per stored image pixel,
// independent of the fixed backing surface above. Range is deliberately a
// couple of named constants so it is trivial to widen later.
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

// The zoom level that reproduces the old fixed DISPLAY_WIDTH canvas for an
// ink at the default stored image size. Inline clamp instead of clampZoom to
// keep constants free of function imports.
export const DEFAULT_ZOOM = Math.min(
  Math.max(Math.round(DISPLAY_WIDTH / IMAGE_SIZE), MIN_ZOOM),
  MAX_ZOOM,
);

// Brushes are sized by how many CSS pixels they occupy inline at the reference
// display height (1.5em on a 16px font, i.e. the whole square shown at 24px).
// The fixed surface plus downsample-on-export makes a stroke render at the
// same inline px whatever the file's export resolution, so no hard-coded
// pixels.
export const REFERENCE_INLINE_PX = 24;
export const BRUSH_SIZES = [
  { label: "S", inlinePx: 1 },
  { label: "M", inlinePx: 2 },
  { label: "L", inlinePx: 3 },
  { label: "XL", inlinePx: 4 },
] as const;
export const DEFAULT_BRUSH_INLINE_PX = BRUSH_SIZES[1].inlinePx; // M

export const MAX_UNDO_STEPS = 50;

// Pixels darker than this (grayscale, composited on white) count as ink for
// width-step detection. Must match how flattenCanvasToGrayscale flattens
// pixels so live detection and post-flatten detection agree.
export const INK_THRESHOLD = 250;

// Cap height as a fraction of the text em. Measured from the default text
// font once; falls back to this nominal value. Custom-font alignment is out
// of scope.
export const DEFAULT_CAP_HEIGHT_RATIO = 0.7;
export const DEFAULT_DISPLAY_HEIGHT_EM = 1.5;

// Zero-padded width of auto-generated ink names ("001", "002", …).
export const AUTO_NAME_PAD_WIDTH = 3;
