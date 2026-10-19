import type InklinePlugin from "../../../src/main.ts";

declare module "wdio-obsidian-service" {
  interface InstalledPlugins {
    inkline: InklinePlugin;
  }
}
