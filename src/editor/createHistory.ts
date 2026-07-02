import { MAX_UNDO_STEPS } from "../constants";
import { canvasToPngBlob } from "../canvas/canvasToPngBlob";

/**
 * Undo/redo for the drawing surface.
 *
 * @remarks
 * History entries are compressed PNG snapshots. Each entry is the pending
 * encode of the surface as it was when the entry was pushed;
 * `canvasToPngBlob` copies the bitmap synchronously, so stack order alone
 * defines history order and restores only have to await the encode before
 * decoding.
 *
 * @privateRemarks
 * PNG snapshots instead of raw ImageData: 50 full-surface raw frames would
 * be ~66 MB.
 */
export interface EditorHistory {
  /**
   * Whether a queued restore or task is still pending; block strokes then.
   *
   * @returns True while any queued task has not finished.
   */
  isBusy(): boolean;
  /** Snapshot the surface as a new undo point and drop the redo stack. */
  record(): void;
  /** Restore the previous snapshot, pushing the current state to redo. */
  undo(): void;
  /** Restore the next snapshot, pushing the current state back to undo. */
  redo(): void;
  /**
   * Serialize a task with the restore queue.
   *
   * @remarks
   * Tasks run strictly in the order they were requested, and stroke input
   * is ignored while any task is pending (see
   * {@link EditorHistory.isBusy}), so a fast stroke/undo/redo burst can
   * never interleave into a wrong restore.
   *
   * @param task - The task to queue; errors are logged, not rethrown.
   */
  run(task: () => void | Promise<void>): void;
  /**
   * Wait for the queue to drain.
   *
   * @returns A promise that resolves once every task queued so far has
   *   finished.
   */
  settled(): Promise<void>;
}

/** Dependencies of {@link createHistory}. */
export interface EditorHistoryDeps {
  /** The drawing canvas snapshots are taken from. */
  canvasEl: HTMLCanvasElement;
  /** The 2D context restores are drawn through. */
  ctx: CanvasRenderingContext2D;
  /** Called after a restore lands on the surface. */
  onRestore(): void;
}

/**
 * Create the editor's undo/redo history over a drawing surface.
 *
 * @remarks
 * The undo stack holds at most {@link MAX_UNDO_STEPS} snapshots; recording
 * beyond that drops the oldest. Recording also clears the redo stack, like
 * any linear-history editor.
 *
 * @param deps - The canvas, context, and restore callback.
 * @returns The history surface.
 */
export function createHistory(deps: EditorHistoryDeps): EditorHistory {
  const { canvasEl, ctx } = deps;
  const undoStack: Promise<Blob>[] = [];
  const redoStack: Promise<Blob>[] = [];
  let chain: Promise<void> = Promise.resolve();
  let pendingTasks = 0;

  const run = (task: () => void | Promise<void>): void => {
    pendingTasks += 1;
    chain = chain
      .then(task)
      .catch((error: unknown) => {
        console.error("Inkline: canvas history operation failed", error);
      })
      .then(() => {
        pendingTasks -= 1;
      });
  };

  const restoreLatest = async (
    source: Promise<Blob>[],
    target: Promise<Blob>[],
  ): Promise<void> => {
    const snapshot = source.pop();
    if (!snapshot) {
      return;
    }

    // Snapshot the current state onto the opposite stack before restoring.
    // All earlier tasks in the chain have completed and strokes are blocked
    // while this task is pending, so the surface is the true current state.
    target.push(canvasToPngBlob(canvasEl));

    const bitmap = await createImageBitmap(await snapshot);
    try {
      // Snapshots are opaque full-surface PNGs, so drawing fully replaces
      // the previous state without clearing first.
      ctx.drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }

    deps.onRestore();
  };

  return {
    isBusy: () => pendingTasks > 0,
    record() {
      undoStack.push(canvasToPngBlob(canvasEl));
      if (undoStack.length > MAX_UNDO_STEPS) {
        undoStack.shift();
      }
      redoStack.length = 0;
    },
    undo() {
      run(() => restoreLatest(undoStack, redoStack));
    },
    redo() {
      run(() => restoreLatest(redoStack, undoStack));
    },
    run,
    settled: () => chain,
  };
}
