import { App, ButtonComponent, Modal, Setting } from "obsidian";

export class InkNameModal extends Modal {
  private inputEl!: HTMLInputElement;

  constructor(
    app: App,
    private readonly defaultName: string,
    private readonly onSubmit: (name: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("inkline-name-modal");

    contentEl.createEl("h2", { text: "New inline ink" });

    new Setting(contentEl)
      .setName("Name")
      .setDesc("Use the next number or replace it with a custom name.")
      .addText((text) => {
        text.setValue(this.defaultName);
        this.inputEl = text.inputEl;
        this.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.submit();
          }
        });
      });

    const controlsEl = contentEl.createDiv({ cls: "inkline-name-modal-controls" });
    new ButtonComponent(controlsEl)
      .setButtonText("Cancel")
      .onClick(() => this.close());

    new ButtonComponent(controlsEl)
      .setButtonText("Create")
      .setCta()
      .onClick(() => this.submit());

    window.setTimeout(() => {
      this.inputEl.focus();
      this.inputEl.select();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    const name = this.inputEl.value.trim() || this.defaultName;
    this.onSubmit(name);
    this.close();
  }
}

export function promptForInkName(app: App, defaultName: string): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const modal = new InkNameModal(app, defaultName, (name) => {
      resolved = true;
      resolve(name);
    });

    const originalOnClose = modal.onClose.bind(modal);
    modal.onClose = () => {
      originalOnClose();
      if (!resolved) {
        resolve(null);
      }
    };

    modal.open();
  });
}
