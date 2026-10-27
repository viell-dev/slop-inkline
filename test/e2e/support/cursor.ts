import { browser } from "@wdio/globals";

/** Read the cursor's actual bitmap through the host canvas, not a screenshot. */
export async function cursorImage() {
  return browser.execute(() => {
    const surface = document.querySelector(".inkline-surface");
    const canvas = document.querySelector(".inkline-brush-cursor");
    if (surface === null || !(canvas instanceof HTMLCanvasElement))
      throw new Error("no brush bitmap");
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no context");
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const ratio = devicePixelRatio;
    const centre = (start: number, end: number): number => {
      let sum = 0;
      let weight = 0;
      for (let x = start; x < end; x++) {
        const at = (cy * canvas.width + x) * 4;
        // The ring's coverage is independent of its adaptive black/white RGB.
        const amount = (pixels[at + 3] ?? 0) / 255;
        sum += (x + 0.5) * amount;
        weight += amount;
      }
      return sum / weight;
    };
    const gap = Math.ceil(3 * ratio);
    return {
      css: getComputedStyle(surface).cursor,
      bitmap: canvas.toDataURL(),
      width: canvas.width,
      height: canvas.height,
      hotspot: [cx, cy],
      diameter: (centre(cx + gap, canvas.width) - centre(0, cx - gap)) / ratio,
      pixels: [...pixels],
    };
  });
}

export async function hasBrushCursor(): Promise<boolean> {
  return browser.execute(() => {
    const cursor = document.querySelector(".inkline-brush-cursor");
    const surface = document.querySelector(".inkline-surface");
    return (
      cursor !== null &&
      surface !== null &&
      getComputedStyle(cursor).display !== "none" &&
      getComputedStyle(surface).cursor === "none"
    );
  });
}

/** Exercise actual host zoom. Electron is used only by this host test. */
export async function setPageZoom(factor: number): Promise<void> {
  await browser.execute((zoom) => {
    const load: unknown = Reflect.get(window, "require");
    if (typeof load !== "function") throw new Error("no host require");
    const electron: unknown = Reflect.apply(load, window, ["electron"]);
    const frame: unknown = Reflect.get(Object(electron), "webFrame");
    const set: unknown = Reflect.get(Object(frame), "setZoomFactor");
    if (typeof set !== "function") throw new Error("no host zoom");
    Reflect.apply(set, frame, [zoom]);
  }, factor);
  await browser.execute(async () => {
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => {
        resolve();
      }),
    );
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => {
        resolve();
      }),
    );
  });
}
