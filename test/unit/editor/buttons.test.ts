import { describe, expect, it } from "vitest";
import {
  buttonFace,
  buttonIcons,
  buttonLabelNames,
  buttonStates,
  controls,
  isButtonLabels,
  keyText,
  pictureHints,
  quickStart,
  type ButtonInputs,
  type ButtonStates,
  type Control,
  type ControlRow,
  type EditorCommands,
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

describe("keyText", () => {
  it("writes a key as the tooltips and the guide do", () => {
    expect(keyText({ modifiers: [], key: "p" })).toBe("P");
    expect(keyText({ modifiers: ["Shift"], key: "g" })).toBe("Shift+G");
    expect(keyText({ modifiers: ["Mod", "Shift"], key: "z" })).toBe(
      "Mod+Shift+Z",
    );
    expect(keyText({ modifiers: ["Mod"], key: "Enter" })).toBe("Mod+Enter");
    expect(keyText({ modifiers: [], key: "ArrowUp" })).toBe("ArrowUp");
    expect(keyText({ modifiers: [], key: "1" })).toBe("1");
  });
});

/** The first key of `control`, as its tooltip shows it. */
function shownKey(control: Control): string {
  const [key] = control.keys;
  if (key === undefined) throw new Error(`${control.id} has no key`);
  return keyText(key);
}

describe("controls", () => {
  const ids = controls.map(({ id }) => id);

  it("gives each button its own id, and each key to one button", () => {
    expect(new Set(ids).size).toBe(ids.length);
    const keys = controls.flatMap(({ keys }) => keys.map(keyText));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts each button in its row, in the order they show", () => {
    const row = (name: ControlRow): string[] =>
      controls.filter((control) => control.row === name).map(({ id }) => id);
    expect(row("tools")).toEqual([
      "pen",
      "eraser",
      "ellipse",
      "polygon",
      "path",
      "fill",
    ]);
    expect(row("history")).toEqual([
      ...brushSizes.map((_, index) => `size-${String(index)}`),
      "undo",
      "redo",
      "clear",
      "move-up",
      "move-down",
    ]);
    expect(row("view")).toEqual([
      "guides",
      "grid",
      "flat-ends",
      "copy",
      "fit",
      "zoom",
      "save",
      "next",
      "help",
    ]);
    expect(row("picture")).toEqual(["choose", "move", "ink", "remove"]);
    expect(row("convert")).toEqual(["light", "apply", "cancel"]);
  });

  it("names each brush size, and gives it its key", () => {
    const sizes = controls.filter(({ id }) => id.startsWith("size-"));
    expect(sizes.map(({ text, label }) => [text, label])).toEqual(
      brushSizes.map((size) => [size.label, `Brush size ${size.label}`]),
    );
    expect(sizes.map(shownKey)).toEqual(["1", "2", "3", "4"]);
  });

  it("leaves the keys that do more than a button's to the controls", () => {
    // Mod+S saves with no button, Enter ends a shape on the drawing area
    // alone, and while Move is on the arrow keys move the picture and + and
    // − scale it: the controls give each of those keys one handler, which
    // Obsidian's scope needs, as it runs only the first.
    const theirs = ["Mod+S", "Enter", "+", "Shift++", "=", "-"];
    for (const control of controls) {
      const arrows = control.keys.filter(({ key }) => key.startsWith("Arrow"));
      expect(control.arrowKeys === true, control.id).toBe(arrows.length > 0);
      expect(arrows.length, control.id).toBe(
        control.arrowKeys === true ? control.keys.length : 0,
      );
      for (const key of control.keys.map(keyText)) {
        expect(theirs, control.id).not.toContain(key);
      }
    }
    expect(
      controls.filter((control) => control.arrowKeys).map(({ id }) => id),
    ).toEqual(["move-up", "move-down"]);
  });

  it("lets the saving keys work while typing, and offers Copy from and Next only for a new symbol", () => {
    expect(
      controls.filter((control) => control.anywhere).map(({ id }) => id),
    ).toEqual(["save", "next"]);
    expect(
      controls.flatMap(({ id, needs }) =>
        needs === undefined ? [] : [[id, needs]],
      ),
    ).toEqual([
      ["copy", "copyFrom"],
      ["next", "next"],
    ]);
    expect(
      controls.filter((control) => control.cta).map(({ id }) => id),
    ).toEqual(["save", "next", "apply"]);
  });

  it("gives each button its own icon, if it has one", () => {
    for (const id of Object.keys(buttonIcons)) expect(ids).toContain(id);
  });

  it("runs the same command from a button and from its keys, with Shift for a cell", () => {
    const calls: string[] = [];
    const record =
      (name: string) =>
      (...args: unknown[]): void => {
        calls.push([name, ...args.map((arg) => String(arg))].join(" "));
      };
    const editor: EditorCommands = {
      setTool: record("setTool"),
      toggleEllipse: record("toggleEllipse"),
      togglePolygon: record("togglePolygon"),
      togglePath: record("togglePath"),
      toggleFill: record("toggleFill"),
      setSize: record("setSize"),
      undo: record("undo"),
      redo: record("redo"),
      clear: record("clear"),
      moveDrawing: record("moveDrawing"),
      toggleGuides: record("toggleGuides"),
      toggleGrid: record("toggleGrid"),
      toggleFlatEnds: record("toggleFlatEnds"),
      copy: record("copy"),
      fit: record("fit"),
      toggleZoom: record("toggleZoom"),
      saveAndClose: record("saveAndClose"),
      saveOnly: record("saveOnly"),
      saveAndNext: record("saveAndNext"),
      help: record("help"),
      choosePicture: record("choosePicture"),
      trace: record("trace"),
      toggleMove: record("toggleMove"),
      toggleConvert: record("toggleConvert"),
      removePicture: record("removePicture"),
      setThreshold: record("setThreshold"),
      toggleLight: record("toggleLight"),
      applyInk: record("applyInk"),
      cancelInk: record("cancelInk"),
      endShape: () => false,
      arrowKey: () => false,
      movingPicture: () => false,
      nudgePicture: record("nudgePicture"),
      scalePictureStep: record("scalePictureStep"),
      refocus: record("refocus"),
    };
    const ran = (shift: boolean): Record<string, string[]> =>
      Object.fromEntries(
        controls.map((control) => {
          calls.length = 0;
          control.run(editor, shift);
          return [control.id, [...calls]];
        }),
      );
    const plain = ran(false);
    expect(plain).toEqual({
      pen: ["setTool pen"],
      eraser: ["setTool eraser"],
      ellipse: ["toggleEllipse"],
      polygon: ["togglePolygon"],
      path: ["togglePath"],
      fill: ["toggleFill"],
      ...Object.fromEntries(
        brushSizes.map((_, index) => [
          `size-${String(index)}`,
          [`setSize ${String(index)}`],
        ]),
      ),
      undo: ["undo"],
      redo: ["redo"],
      clear: ["clear"],
      "move-up": ["moveDrawing -1 false"],
      "move-down": ["moveDrawing 1 false"],
      guides: ["toggleGuides"],
      grid: ["toggleGrid"],
      "flat-ends": ["toggleFlatEnds"],
      copy: ["copy"],
      fit: ["fit"],
      zoom: ["toggleZoom"],
      save: ["saveAndClose"],
      next: ["saveAndNext"],
      help: ["help"],
      choose: ["choosePicture"],
      move: ["toggleMove"],
      ink: ["toggleConvert"],
      remove: ["removePicture"],
      light: ["toggleLight"],
      apply: ["applyInk"],
      cancel: ["cancelInk"],
    });
    // Shift moves the drawing by a cell, and changes nothing else.
    expect(ran(true)).toEqual({
      ...plain,
      "move-up": ["moveDrawing -1 true"],
      "move-down": ["moveDrawing 1 true"],
    });
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
    inkOpen: false,
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
    // Make ink shows on only while it is open.
    expect(tracing.pressed.ink).toBe(false);
  });

  it("shows the bar that makes ink, its threshold, Light ink, and Apply while it runs", () => {
    const making = states({
      picture: true,
      converting: { threshold: 140, light: false },
      inkOpen: true,
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

  it("shows Make ink as it will be once the pointer is let go, and its bar as it is", () => {
    // Asked to open while the pointer is pressed to draw.
    expect(states({ picture: true, inkOpen: true })).toMatchObject({
      pressed: { ink: true },
      convertBar: false,
      threshold: undefined,
      hint: pictureHints.tracing,
    });
    // Asked to close.
    expect(
      states({
        picture: true,
        converting: { threshold: 140, light: false },
        inkOpen: false,
      }),
    ).toMatchObject({
      pressed: { ink: false },
      convertBar: true,
      threshold: 140,
      hint: pictureHints.making,
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
    // And every entry is for a button the editor has.
    const buttons = controls.map(({ id }) => id);
    for (const id of [...ids(busy.pressed), ...ids(busy.disabled)]) {
      expect(buttons).toContain(id);
    }
  });
});

describe("quickStart", () => {
  const text = [quickStart.intro, ...quickStart.steps].join("\n");

  it("gives a button its key wherever it names the two together", () => {
    let named = 0;
    for (const control of controls) {
      if (control.keys.length === 0 || control.id.startsWith("size-")) {
        continue;
      }
      const name = control.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const match of text.matchAll(
        new RegExp(`\\b${name} \\(([^)]+)\\)`, "g"),
      )) {
        expect(match[1], control.text).toBe(shownKey(control));
        named++;
      }
    }
    expect(named).toBeGreaterThan(10);
  });

  it("names the brush sizes from first to last, with their keys", () => {
    const sizes = controls.filter(({ id }) => id.startsWith("size-"));
    const [first] = sizes;
    const last = sizes.at(-1);
    if (first === undefined || last === undefined) throw new Error("no sizes");
    expect(text).toContain(
      `Sizes ${first.text}–${last.text} (${shownKey(first)}–${shownKey(last)})`,
    );
  });
});
