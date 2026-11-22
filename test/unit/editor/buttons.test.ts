import { describe, expect, it } from "vitest";
import {
  buttonFace,
  buttonIcons,
  buttonLabelNames,
  buttonStates,
  isButtonLabels,
  pictureHints,
  type ButtonInputs,
  type ButtonStates,
} from "../../../src/editor/buttons.ts";
import { brushSizes } from "../../../src/editor/session.ts";

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

describe("buttonStates", () => {
  /** A new editor's: the pen, freehand, nothing drawn, no picture. */
  const opened: ButtonInputs = {
    tool: "pen",
    shape: "free",
    fill: false,
    moving: false,
    picture: false,
    converting: undefined,
    applying: false,
    guides: true,
    grid: false,
    canEndFlat: false,
    flatEnds: false,
    zoomed: false,
    sizeIndex: 1,
    canUndo: false,
    canRedo: false,
    placing: false,
    empty: true,
    saving: false,
  };
  const states = (changes: Partial<ButtonInputs>): ButtonStates =>
    buttonStates({ ...opened, ...changes });

  it("says what a new editor's buttons show", () => {
    expect(buttonStates(opened)).toEqual({
      pressed: {
        pen: true,
        eraser: false,
        ellipse: false,
        polygon: false,
        path: false,
        fill: false,
        move: false,
        ink: false,
        light: false,
        guides: true,
        grid: false,
        "flat-ends": false,
        zoom: false,
        "size-0": false,
        "size-1": true,
        "size-2": false,
        "size-3": false,
      },
      disabled: {
        fill: true,
        move: true,
        remove: true,
        ink: true,
        apply: false,
        "flat-ends": true,
        undo: true,
        redo: true,
        "move-up": true,
        "move-down": true,
        save: false,
        next: false,
      },
      convertBar: false,
      threshold: undefined,
      hint: pictureHints.none,
    });
  });

  it("presses the tool and the shape drawn with, and neither while moving the picture", () => {
    expect(states({ tool: "eraser" }).pressed).toMatchObject({
      pen: false,
      eraser: true,
    });
    for (const shape of ["ellipse", "polygon", "path"] as const) {
      const { pressed } = states({ shape });
      expect(pressed[shape]).toBe(true);
      expect(pressed.pen).toBe(true);
      expect(
        ["ellipse", "polygon", "path"].filter((other) => pressed[other]),
      ).toEqual([shape]);
    }
    for (const tool of ["pen", "eraser"] as const) {
      for (const shape of ["free", "ellipse", "polygon", "path"] as const) {
        const moving = states({ tool, shape, picture: true, moving: true });
        expect(moving.pressed).toMatchObject({
          pen: false,
          eraser: false,
          ellipse: false,
          polygon: false,
          path: false,
          move: true,
        });
      }
    }
  });

  it("offers Toggle fill for a shape alone, and shows it on only then", () => {
    expect(states({ fill: true }).pressed.fill).toBe(false);
    expect(states({ fill: true }).disabled.fill).toBe(true);
    for (const shape of ["ellipse", "polygon", "path"] as const) {
      expect(states({ shape }).disabled.fill).toBe(false);
      expect(states({ shape }).pressed.fill).toBe(false);
      expect(states({ shape, fill: true }).pressed.fill).toBe(true);
    }
  });

  it("offers Flat ends where strokes can end flat, and shows it on only then", () => {
    expect(states({ flatEnds: true })).toMatchObject({
      pressed: { "flat-ends": false },
      disabled: { "flat-ends": true },
    });
    expect(states({ canEndFlat: true })).toMatchObject({
      pressed: { "flat-ends": false },
      disabled: { "flat-ends": false },
    });
    expect(states({ canEndFlat: true, flatEnds: true }).pressed).toMatchObject({
      "flat-ends": true,
    });
  });

  it("offers the picture's buttons once there is a picture, and says what it is for", () => {
    const tracing = states({ picture: true });
    expect(tracing.disabled).toMatchObject({
      move: false,
      remove: false,
      ink: false,
    });
    expect(tracing.hint).toBe(pictureHints.tracing);
    expect(tracing.convertBar).toBe(false);
    // Make ink shows on only while its bar is open.
    expect(tracing.pressed.ink).toBe(false);
  });

  it("shows the bar that makes ink, its threshold, Light ink, and Apply while it runs", () => {
    const making = states({
      picture: true,
      converting: { threshold: 140, light: false },
    });
    expect(making).toMatchObject({
      pressed: { ink: true, light: false },
      disabled: { apply: false },
      convertBar: true,
      threshold: 140,
      hint: pictureHints.making,
    });
    expect(
      states({
        picture: true,
        converting: { threshold: 90, light: true },
        applying: true,
      }),
    ).toMatchObject({
      pressed: { light: true },
      disabled: { apply: true },
      threshold: 90,
    });
  });

  it("moves the drawing up and down when it holds something, but not while making ink", () => {
    expect(states({ empty: false }).disabled).toMatchObject({
      "move-up": false,
      "move-down": false,
    });
    expect(
      states({
        empty: false,
        picture: true,
        converting: { threshold: 140, light: false },
      }).disabled,
    ).toMatchObject({ "move-up": true, "move-down": true });
  });

  it("offers Undo for a step or a corner to take back, and Redo for a step to bring back", () => {
    expect(states({ canUndo: true }).disabled.undo).toBe(false);
    expect(states({ placing: true }).disabled.undo).toBe(false);
    expect(states({ canRedo: true }).disabled.redo).toBe(false);
    expect(states({ placing: true }).disabled.redo).toBe(true);
  });

  it("holds Save and Next while a save runs", () => {
    expect(states({ saving: true }).disabled).toMatchObject({
      save: true,
      next: true,
    });
  });

  it("shows the guides, the grid, Zoom, and one size each as it is", () => {
    expect(
      states({ guides: false, grid: true, zoomed: true }).pressed,
    ).toMatchObject({ guides: false, grid: true, zoom: true });
    brushSizes.forEach((_, index) => {
      const { pressed } = states({ sizeIndex: index });
      expect(
        brushSizes
          .map((__, size) => `size-${String(size)}`)
          .filter((id) => pressed[id]),
      ).toEqual([`size-${String(index)}`]);
    });
  });

  it("names the same buttons whatever the editor holds, and none without a state", () => {
    const ids = (record: Readonly<Record<string, boolean>>): string[] =>
      Object.keys(record).sort();
    const busy = states({
      tool: "eraser",
      shape: "path",
      picture: true,
      moving: true,
      converting: { threshold: 1, light: true },
      saving: true,
    });
    expect(ids(busy.pressed)).toEqual(ids(buttonStates(opened).pressed));
    expect(ids(busy.disabled)).toEqual(ids(buttonStates(opened).disabled));
    // A button that has no state of its own, as Save's pressed or Help's
    // either, has no entry, so the editor leaves its attributes alone.
    for (const id of ["save", "next", "help", "clear", "fit", "copy"]) {
      expect(busy.pressed[id]).toBeUndefined();
    }
    for (const id of ["pen", "help", "clear", "fit", "copy", "light"]) {
      expect(busy.disabled[id]).toBeUndefined();
    }
  });
});
