// Faults of the disk a save writes to, stood in for in real Obsidian: a copy
// that stops part-way, a removal that fails, and a watch of the disk that has
// not reported yet. Shared by the specs that test what a save leaves.

import { browser } from "@wdio/globals";

/**
 * Has the next copy to `path` by Obsidian's file system stop after its first
 * `cut` bytes and fail as on a full disk, leaving those bytes at `path`, as a
 * system whose copy does not take away what it left would. With `stays`, the
 * next removal of `path` fails too, as of a file another program has open.
 * Taken off by their first such calls, or by `undoStubs()`.
 */
export async function cutCopyAt(
  path: string,
  cut: number,
  { stays = false }: { stays?: boolean } = {},
): Promise<void> {
  await browser.executeObsidian(
    ({ app }, wanted, at, held) => {
      const promises: unknown = Reflect.get(app.vault.adapter, "fsPromises");
      if (typeof promises !== "object" || promises === null) {
        throw new Error("no file system to fill");
      }
      const copy: unknown = Reflect.get(promises, "copyFile");
      const write: unknown = Reflect.get(promises, "writeFile");
      const readFile: unknown = Reflect.get(promises, "readFile");
      const unlink: unknown = Reflect.get(promises, "unlink");
      if (
        typeof copy !== "function" ||
        typeof write !== "function" ||
        typeof readFile !== "function" ||
        typeof unlink !== "function"
      ) {
        throw new Error("no file system to stub");
      }
      const restoreCopy = (): void => {
        Reflect.set(promises, "copyFile", copy);
      };
      const restoreUnlink = (): void => {
        Reflect.set(promises, "unlink", unlink);
      };
      Reflect.set(window, "inklineAtEnd-cut-copy", () => {
        restoreCopy();
        restoreUnlink();
        Reflect.deleteProperty(window, "inklineAtEnd-cut-copy");
      });
      Reflect.set(
        promises,
        "copyFile",
        async (from: unknown, to: unknown, ...rest: unknown[]) => {
          if (typeof to !== "string" || !to.endsWith(wanted)) {
            const copied: unknown = await Reflect.apply(copy, promises, [
              from,
              to,
              ...rest,
            ]);
            return copied;
          }
          restoreCopy();
          const bytes: unknown = await Reflect.apply(readFile, promises, [
            from,
          ]);
          if (!ArrayBuffer.isView(bytes)) throw new Error("no bytes to copy");
          const part = new Uint8Array(
            bytes.buffer,
            bytes.byteOffset,
            Math.min(at, bytes.byteLength),
          );
          // Made only where nothing is, as the copy itself makes it.
          await Reflect.apply(write, promises, [to, part, { flag: "wx" }]);
          throw Object.assign(
            new Error("ENOSPC: no space left on device, copyfile"),
            { code: "ENOSPC" },
          );
        },
      );
      if (!held) return;
      Reflect.set(
        promises,
        "unlink",
        async (file: unknown, ...rest: unknown[]) => {
          if (typeof file !== "string" || !file.endsWith(wanted)) {
            const removed: unknown = await Reflect.apply(unlink, promises, [
              file,
              ...rest,
            ]);
            return removed;
          }
          restoreUnlink();
          throw Object.assign(
            new Error("EBUSY: resource busy or locked, unlink"),
            { code: "EBUSY" },
          );
        },
      );
    },
    path,
    cut,
    stays,
  );
}

/**
 * Has Obsidian's watch of the disk keep what it sees of `path` until
 * {@link releaseWatch}, as a watch that has not reported yet, so that a file
 * put there other than through Obsidian's adapter stays unlisted.
 */
export async function holdWatch(path: string): Promise<void> {
  await browser.executeObsidian(({ app }, wanted) => {
    const { adapter } = app.vault;
    const seen: unknown = Reflect.get(adapter, "onFileChange");
    if (typeof seen !== "function") throw new Error("no watch to hold");
    const held: unknown[] = [];
    const release = (): void => {
      Reflect.deleteProperty(adapter, "onFileChange");
      Reflect.deleteProperty(window, "inklineAtEnd-watch");
      for (const changed of held) Reflect.apply(seen, adapter, [changed]);
    };
    Reflect.set(window, "inklineAtEnd-watch", release);
    Reflect.set(adapter, "onFileChange", (changed: unknown) => {
      if (changed === wanted) held.push(changed);
      else Reflect.apply(seen, adapter, [changed]);
    });
  }, path);
}

/** Lets Obsidian's watch report what {@link holdWatch} kept. */
export async function releaseWatch(): Promise<void> {
  await browser.execute(() => {
    const release: unknown = Reflect.get(window, "inklineAtEnd-watch");
    if (typeof release === "function") Reflect.apply(release, window, []);
  });
}

/** Waits for Obsidian to list a file at `path`, as its watch of the disk does. */
export async function waitForListed(path: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(
        ({ app }, wanted) => app.vault.getFileByPath(wanted) !== null,
        path,
      ),
    { timeoutMsg: `Obsidian did not list ${path}` },
  );
}
