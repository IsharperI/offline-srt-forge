
# Fix: Queue Hang Prevention for Large File Batches

## What's Going Wrong

There are two interlocking bugs that cause files to get stuck in "Queued..." when more than ~10 files are uploaded.

### Bug 1: Silent bail in `initializeTranscriber`

Inside `initializeTranscriber` (in `transcription.ts`), there is a guard at the top:

```
if (isLoading) return;
```

This returns `undefined` — a completely silent no-op. When a queued file starts processing while the model is already loading for the previous file, `transcribeAudio` calls `initializeTranscriber`, which returns immediately leaving `transcriber` as `null`. The code then hits the null-check right after and throws `'Failed to initialize transcription model'`. This error bubbles to the `catch` block in `processNextInQueue`, which correctly marks the file as errored and releases `isProcessingRef`... but this means files 2–N in a large batch can error out instantly rather than waiting for the model to finish loading.

The fix: replace `if (isLoading) return;` with a **wait-and-share** mechanism using a `Promise` that all callers can `await`. If loading is already in progress, any subsequent caller simply awaits the same in-flight promise instead of bailing out.

### Bug 2: No timeout watchdog

The transcription of a single file (`transcriber!(audioUrl, ...)`) is a raw `await` with no timeout. If the WebAssembly model hangs on a malformed audio file, all subsequent queued files are frozen indefinitely because `isProcessingRef.current` is never set back to `false`.

The fix: wrap the `transcriber` call in a `Promise.race` with a configurable timeout (default: 3 minutes). If it times out, a descriptive error is thrown, the catch block handles it normally, and the queue advances to the next file.

## Changes — Two files only

### `src/lib/transcription.ts`

**1. Replace the `isLoading` boolean guard with a shared promise:**

```ts
// Before (broken):
let isLoading = false;
// ...
if (isLoading) return;  // <-- silent bail
isLoading = true;

// After (fixed):
let loadingPromise: Promise<void> | null = null;
// ...
if (loadingPromise) return loadingPromise;  // <-- await the same promise
loadingPromise = (async () => { ... })().finally(() => { loadingPromise = null; });
return loadingPromise;
```

Every caller — no matter how many files are in the queue — will now `await` the single shared loading promise rather than getting a silent no-op.

**2. Add a per-file transcription timeout:**

A `withTimeout` helper wraps the model call:

```ts
const TRANSCRIPTION_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s: ${label}`)), ms)
    )
  ]);
}
```

The `transcriber!(audioUrl, { ... })` call is wrapped:

```ts
const result = await withTimeout(
  transcriber!(audioUrl, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 }),
  TRANSCRIPTION_TIMEOUT_MS,
  audioFile.name
);
```

**3. Add a timeout error message to `Index.tsx`:**

In `processNextInQueue`'s catch block, add a check for timeout errors so users see a clear message rather than a raw error string:

```ts
} else if (error.message.includes('Timed out')) {
  errorMessage = 'Processing timed out — file may be too long or corrupted';
}
```

### `src/pages/Index.tsx`

Only the error message handler in `processNextInQueue` is updated — one extra `else if` branch for timeout detection. No structural changes.

## What stays the same

- Sequential processing order (one file at a time) is preserved.
- The queue data structure (`fileQueueRef`, `isProcessingRef`) is unchanged.
- All existing error handling paths are unchanged.
- No new dependencies.
- No UI changes beyond the new timeout error message string.

## Outcome

- With 10+ files: files 2–N now correctly wait for the model to finish loading before attempting transcription, instead of erroring or hanging.
- If any single file hangs the model for more than 3 minutes, it is automatically marked as an error and the queue advances.
- The "Queued..." status resolves correctly for every file in the batch.
