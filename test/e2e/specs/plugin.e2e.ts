import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { saveScreenshot } from "../support/screenshots.ts";

async function isLoaded(): Promise<boolean> {
  return browser.executeObsidian(({ plugins }) => "inkline" in plugins);
}

describe("The plugin", function () {
  it("is loaded when the vault opens", async function () {
    expect(await isLoaded()).toBe(true);
    await obsidianPage.openFile("Welcome.md");
    await saveScreenshot("loaded");
  });

  it("unloads and loads again", async function () {
    await obsidianPage.disablePlugin("inkline");
    expect(await isLoaded()).toBe(false);
    await obsidianPage.enablePlugin("inkline");
    expect(await isLoaded()).toBe(true);
  });
});
