export interface InkLineLayout {
  // Canvas-pixel positions (0..IMAGE_SIZE) of the cap-line and baseline.
  capLineY: number;
  baselineY: number;
  // Inline vertical-align (em, negative) that centers the cap band on the
  // line.
  verticalAlignEm: number;
}
