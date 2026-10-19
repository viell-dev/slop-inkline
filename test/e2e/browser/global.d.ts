import type * as modules from "./entry.ts";

declare global {
  /** Set by {@link import("../support/browser.ts").loadModules}. */
  var inklineTest: typeof modules;
}
