/** An image embed found on a line, with its cursor-offset boundaries. */
export interface ImageToken {
  path: string;
  from: number;
  to: number;
}
