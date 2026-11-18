import { describe, expect, it } from "vitest";
import { StatusLine } from "../../../src/editor/status.ts";

/** A status line, with every text it showed, as a live region would get it. */
function line(): { status: StatusLine; shown: string[] } {
  const shown: string[] = [];
  return {
    status: new StatusLine((text) => {
      shown.push(text);
    }),
    shown,
  };
}

describe("StatusLine", () => {
  it("says a message until the next action that says nothing", () => {
    const { status, shown } = line();
    status.say("Zoomed out");
    expect(status.text).toBe("Zoomed out");
    // Fit says nothing: the line empties rather than speak for it.
    status.act(() => undefined);
    expect(status.text).toBe("");
    expect(shown).toEqual(["Zoomed out", ""]);
  });

  it("keeps what an action says, in place of what was there", () => {
    const { status, shown } = line();
    status.say("Polygon dropped");
    status.act(() => {
      status.say("Making ink of the picture: set the threshold, then Apply.");
    });
    expect(status.text).toBe(
      "Making ink of the picture: set the threshold, then Apply.",
    );
    // Never emptied on the way, so a screen reader hears one change.
    expect(shown).toEqual([
      "Polygon dropped",
      "Making ink of the picture: set the threshold, then Apply.",
    ]);
  });

  it("shows nothing more for an action on an empty line", () => {
    const { status, shown } = line();
    status.act(() => undefined);
    status.say("Saved");
    status.act(() => undefined);
    status.act(() => undefined);
    expect(shown).toEqual(["Saved", ""]);
  });

  it("keeps a message that holds, through actions, until it no longer does", () => {
    const { status, shown } = line();
    let saving = true;
    status.say("Saving…", () => saving);
    status.act(() => undefined);
    status.act(() => undefined);
    expect(status.text).toBe("Saving…");
    saving = false;
    status.act(() => undefined);
    expect(status.text).toBe("");
    expect(shown).toEqual(["Saving…", ""]);
  });

  it("lets a later message replace one that holds", () => {
    const { status } = line();
    status.say("Draft not kept", () => true);
    status.say("Zoomed in");
    status.act(() => undefined);
    expect(status.text).toBe("");
  });

  it("leaves the line as it was for an action that did nothing", () => {
    const { status, shown } = line();
    status.say("Zoomed out");
    // An arrow key with nothing to move passes the key on.
    expect(status.actIf(() => false)).toBe(false);
    expect(status.text).toBe("Zoomed out");
    expect(status.actIf(() => true)).toBe(true);
    expect(status.text).toBe("");
    expect(shown).toEqual(["Zoomed out", ""]);
  });

  it("empties the line once, after the outermost of actions inside each other", () => {
    const { status, shown } = line();
    status.say("Saved");
    status.act(() => {
      status.act(() => undefined);
      // Still there while the outer action runs, for it to read.
      expect(status.text).toBe("Saved");
    });
    expect(status.text).toBe("");
    // An inner action's message is the outer one's too.
    status.act(() => {
      status.act(() => {
        status.say("Draft kept");
      });
    });
    expect(status.text).toBe("Draft kept");
    expect(shown).toEqual(["Saved", "", "Draft kept"]);
  });

  it("leaves the line as it was when an action throws, and lets the error go on", () => {
    const { status } = line();
    status.say("Saved");
    expect(() => {
      status.act(() => {
        throw new Error("failed");
      });
    }).toThrow("failed");
    expect(status.text).toBe("Saved");
    status.act(() => undefined);
    expect(status.text).toBe("");
  });
});
