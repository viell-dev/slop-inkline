/**
 * A native cursor, rasterized only when the nominal brush diameter changes.
 * Moving a DOM border through fractional layout coordinates can change its
 * raster shape; the window system moves this fixed image and hotspot instead.
 * PNGs at 1x and 2x keep the same logical size on ordinary and dense displays.
 */
export function brushCursor(diameter: number, doc: Document): string {
  // Chromium limits custom cursors to 128 logical pixels. Never silently
  // shrink an oversized footprint: keep the visible crosshair fallback.
  if (!Number.isFinite(diameter) || diameter <= 0 || diameter > 124) {
    return "crosshair";
  }
  const hotspot = Math.ceil(diameter / 2 + 2);
  const side = hotspot * 2;
  const images: string[] = [];
  for (const scale of [1, 2]) {
    const canvas = doc.createElement("canvas");
    canvas.width = side * scale;
    canvas.height = side * scale;
    const context = canvas.getContext("2d");
    if (context === null) return "crosshair";
    // A white halo and black centre remain visible on ink, tracing pictures,
    // and either theme, without depending on the colour below the pointer.
    // Radial coverage makes the raster symmetric on both axes even at a
    // fractional diameter; a canvas path can give the axes different edge
    // coverage. Feather by one device pixel, independently at each density.
    const pixels = context.createImageData(canvas.width, canvas.height);
    const coverage = (distance: number): number =>
      Math.max(0, Math.min(1, distance + 0.5));
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const distance = Math.hypot(
          x + 0.5 - hotspot * scale,
          y + 0.5 - hotspot * scale,
        );
        const ring = Math.abs(distance - (diameter * scale) / 2);
        const white = Math.max(
          coverage(1.5 * scale - ring),
          coverage(2 * scale - distance),
        );
        const black = Math.max(
          coverage(0.5 * scale - ring),
          coverage(scale - distance),
        );
        const alpha = black + white * (1 - black);
        const colour = alpha === 0 ? 0 : (255 * white * (1 - black)) / alpha;
        const at = (y * canvas.width + x) * 4;
        pixels.data[at] = colour;
        pixels.data[at + 1] = colour;
        pixels.data[at + 2] = colour;
        pixels.data[at + 3] = 255 * alpha;
      }
    }
    context.putImageData(pixels, 0, 0);
    images.push(`url("${canvas.toDataURL()}") ${String(scale)}x`);
  }
  return `image-set(${images.join(", ")}) ${String(hotspot)} ${String(hotspot)}, crosshair`;
}
