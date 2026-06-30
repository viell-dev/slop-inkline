import { Notice, Plugin } from "obsidian";

export default class InklinePlugin extends Plugin {
  async onload(): Promise<void> {
    this.addCommand({
      id: "insert-inline-ink",
      name: "Insert inline ink",
      callback: () => {
        new Notice("Inkline is installed. Drawing tools are coming next.");
      },
    });
  }
}

