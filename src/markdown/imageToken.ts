/** An image embed found on a line, with its cursor-offset boundaries. */
export interface ImageToken {
  /** The link destination: the image path without alias, size, or hash. */
  path: string;
  /** Character offset of the token's start on the line (inclusive). */
  from: number;
  /** Character offset of the token's end on the line (exclusive). */
  to: number;
}
