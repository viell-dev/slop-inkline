/**
 * Bundle entry point. Obsidian instantiates the default export of the built
 * bundle, so this file only re-exports {@link InklinePlugin}; everything
 * else lives in the feature modules.
 */
export { InklinePlugin as default } from "./obsidian/inklinePlugin";
