import { WIDTH_STEPS } from "../constants";

/**
 * One of the export widths a drawing can crop to, as a fraction of the full
 * square (an entry of {@link WIDTH_STEPS}).
 */
export type WidthStep = (typeof WIDTH_STEPS)[number];
