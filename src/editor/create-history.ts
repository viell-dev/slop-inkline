import { MAX_UNDO_STEPS } from "../constants";
import { canvasToPngBlob } from "../canvas/canvas-to-png-blob";

/**
 * Undo/redo for the drawing surface. History entries are compressed PNG
 * snapshots instead of raw ImageData (~66 MB for 50 full-surface frames).
 * Each entry is the pending encode of the surface as it was when the entry
 * was pushed; canvasToPngBlob copies the bitmap synchronously, so stack
 * order alone defines history order and restores only have to await the
 * encode before decoding.
 */
export interface EditorHistory {
  /** True while a queued restore is still pending; block strokes then. */
  isBusy(): boolean;
  /** Snapshot the surface as a new undo point and drop the redo stack. */
  record(): void;
  undo(): void;
  redo(): void;
  /**
   * Serialize a task with the restore queue. Tasks run strictly in the
   * order they were requested, and stroke input is ignored while any task
   * is pending (see isBusy), so a fast stroke/undo/redo burst can never
   * interleave into a wrong restore.
   */
  run(task: () => void | Promise<void>): void;
  /** Resolves once every queued task so far has finished. */
  settled(): Promise<void>;
}

export interface EditorHistoryDeps {
  canvasEl: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Called after a restore lands on the surface. */
  onRestore(): void;
}

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
