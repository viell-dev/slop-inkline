/**
 * The vertical geometry that anchors an ink to the text line, shared by the
 * editor's baseline guides and the render enhancer.
 */
export interface InkLineLayout {
  /** Canvas-pixel y position (0..IMAGE_SIZE) of the cap line. */
  capLineY: number;
  /** Canvas-pixel y position (0..IMAGE_SIZE) of the baseline. */
  baselineY: number;
  /**
   * Inline `vertical-align` in em (negative) that centers the cap band on
   * the line.
   */
  verticalAlignEm: number;
}
