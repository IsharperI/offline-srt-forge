

# Reference Script Upload & Alignment Feature

## Overview

Add the ability for users to upload a reference script (.txt or .docx) or paste text. When provided, the app uses audio transcription for timing but replaces the words with the script text, validated by a 70% word-match threshold.

## New Files

### `src/components/ScriptUpload.tsx`
A component placed between the settings panel and the file dropzone in Index.tsx.

**UI**: A collapsible section with:
- A "Provide Reference Script" toggle/button that expands to reveal:
  - A textarea for pasting text
  - An "Upload .txt/.docx" button (file input accepting `.txt,.docx`)
  - A "Clear Script" button when script is loaded
  - A small status indicator showing word count of loaded script

**Props**: `scriptText: string | null`, `onScriptChange: (text: string | null) => void`, `disabled: boolean`

**DOCX parsing**: Use the `document--parse_document` approach — actually, since this runs client-side, we'll read `.txt` files via `FileReader.readAsText()` and for `.docx` files, extract raw text by reading the XML inside the zip. We'll add a lightweight client-side `.docx` text extractor (the docx format is a zip containing `word/document.xml` — we can use the browser's built-in decompression API or a simple regex on the XML to strip tags). Simpler approach: just support `.txt` files and plain text paste. For `.docx`, we can read it as ArrayBuffer and do basic XML text extraction.

### `src/lib/scriptAlignment.ts`
Contains the alignment and validation logic.

**Exported functions:**

1. **`validateScriptMatch(transcriptText: string, scriptText: string): { isValid: boolean; matchPercentage: number }`**
   - Normalizes both texts (lowercase, strip punctuation, split to words)
   - Uses a simple word-matching algorithm: for each word in the script, check if it appears in the transcript (accounting for order via a sliding window or sequential matching)
   - Returns match percentage and validity (≥70% = valid)

2. **`alignTranscriptToScript(segments: TranscriptSegment[], scriptText: string): TranscriptSegment[]`**
   - Extracts all words with timing from the transcript segments
   - Tokenizes the script into words
   - Performs word-level alignment: maps each transcript word to the corresponding script word using a simple sequential alignment (since both should follow the same order)
   - Handles mismatches (insertions/deletions) by using the script word when the transcript word is a phonetic near-match (e.g., "9" vs "nine"), or keeping the script word with interpolated timing
   - Returns new TranscriptSegment[] with script words but transcript timing

## Changes to Existing Files

### `src/pages/Index.tsx`

- Add `scriptText` state: `useState<string | null>(null)`
- Render `<ScriptUpload>` component between settings panel and file dropzone
- Pass `scriptText` down; disable when processing
- In `processNextInQueue`, after `sanitizeSegments(rawSegments)`:
  - If `scriptText` is provided:
    - Call `validateScriptMatch()` with the raw transcript text and script text
    - If <70% match: set error status on the file with message "Incorrect script file, please try again" and skip to next file
    - If ≥70% match: call `alignTranscriptToScript()` to replace transcript words with script words while keeping timing
    - Pass aligned segments to review state instead of raw cleaned segments

### `src/lib/transcription.ts`

No changes needed. The alignment produces standard `TranscriptSegment[]` which flows through the existing `generateSRT` → `buildCaptionSegments` pipeline, preserving all semantic break rules.

## Alignment Algorithm Detail

The alignment uses a **sequential greedy match**:

```text
Transcript words (with timing):  ["the", "cat", "sat", "on", "9", "chairs"]
Script words (no timing):        ["The", "cat", "sat", "on", "nine", "chairs"]

Step: Walk both lists in parallel.
- If words match (case-insensitive, ignoring punctuation): use script word, keep timing → next both
- If words don't match but are phonetically similar or close edit distance: use script word, keep timing → next both  
- If script has extra word (insertion): insert script word with interpolated timing
- If transcript has extra word (deletion): skip transcript word

Result: script words with transcript timing attached.
```

For the similarity check, use normalized Levenshtein distance with a threshold (≤50% of word length = "close enough") plus a small lookup for common number-to-word mappings (1→one, 2→two, etc.).

## Validation Flow

```text
Audio uploaded → Transcribe (get timing) → Sanitize
                                              ↓
                              Script provided? ──No──→ Normal flow (review)
                                   ↓ Yes
                              Validate match ≥70%?
                                 ↓ No          ↓ Yes
                          Error toast:       Align transcript
                          "Incorrect         to script words
                          script file"       → Review with
                                               aligned captions
```

## UI Placement

The script upload sits in the settings area, below the model selector and character limit, above the file dropzone. It's a collapsible section so it doesn't clutter the UI for users who don't need it.

