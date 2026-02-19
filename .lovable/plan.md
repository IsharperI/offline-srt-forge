
# Add "Clear All" Button

## Overview

A "Clear All" button will be added to each section that can accumulate multiple files: **Processing**, **Review & Edit**, and **Ready to Download**. It appears only when there are 2 or more files in that section (alongside the existing individual "X" remove buttons, which are unchanged).

## Changes — `src/pages/Index.tsx` only

### New handler functions

Three new handlers will be added, one per section:

- `handleClearAllProcessing` — sets `processingFiles` to `[]`
- `handleClearAllReview` — sets `reviewFiles` to `[]`
- `handleClearAllCompleted` — sets `completedFiles` to `[]`

### UI additions

Each section header row (which already uses `flex items-center justify-between`) gets a "Clear All" button on the right side, displayed only when the section has more than 1 file.

**Processing section** — sits next to the existing "Processing" heading. Since there is currently no right-side button here, the header `<h2>` will be wrapped in a flex row and the "Clear All" button added.

**Review & Edit section** — already has a flex header row with the "Generate All" button. The "Clear All" button will be added as a second button beside it (e.g., `gap-2` between them).

**Ready to Download section** — already has a flex header row with the "Download All" button. "Clear All" sits beside it.

### Button style

All three "Clear All" buttons use:
- `variant="ghost"` with `size="sm"` to keep them visually subordinate to the primary action buttons
- `text-muted-foreground hover:text-destructive` colouring to signal a destructive action without being alarming
- `Trash2` icon from `lucide-react`

## Technical Details

- No new files, no new dependencies.
- `Trash2` is imported from `lucide-react` (already installed).
- The `resetTranscriber` import is already present and unused here — no side-effect from the new handlers.
- For **Processing**, clearing the UI list does not cancel the underlying async transcription already running (the active job in `isProcessingRef`). Only queued-but-not-started files will be visually removed. This matches the existing behaviour of the individual "X" button on processing items.
