import { describe, expect, it } from "vitest";
import {
  buttonFace,
  buttonIcons,
  buttonLabelNames,
  isButtonLabels,
} from "../../../src/editor/buttons.ts";

describe("buttonFace", () => {
  it("shows an icon and text, the icon, or the text, as chosen", () => {
    expect(buttonFace("pen", "both")).toEqual({ icon: "pencil", text: true });
    expect(buttonFace("pen", "icons")).toEqual({ icon: "pencil", text: false });
    expect(buttonFace("pen", "text")).toEqual({ icon: undefined, text: true });
  });

  it("keeps the text of a button without an icon under every choice", () => {
    for (const id of ["size-0", "size-3", "light", "apply", "cancel"]) {
      for (const labels of ["both", "icons", "text"] as const) {
        expect(buttonFace(id, labels)).toEqual({ icon: undefined, text: true });
      }
    }
  });
});

describe("buttonIcons", () => {
  it("gives each button its own icon", () => {
    const icons = Object.values(buttonIcons);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("isButtonLabels", () => {
  it("accepts the three choices only", () => {
    for (const choice of Object.keys(buttonLabelNames)) {
      expect(isButtonLabels(choice)).toBe(true);
    }
    for (const value of ["Icons only", "icon", "", undefined, 1]) {
      expect(isButtonLabels(value)).toBe(false);
    }
  });
});
