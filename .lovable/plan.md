

# Fix: Strip Timestamp Tokens from Caption Text

## Problem

The Whisper model occasionally leaks timestamp tokens into the transcribed text itself. These appear as patterns like `<|0.00|>`, `<|12.34|>`, or similar numeric markers embedded within the words. Since there is no sanitization step to catch these, they end up in the final SRT captions.

## Solution

Add timestamp token stripping in two places for defense-in-depth:

### 1. At ingestion (line ~253 in `transcribeAudio`)

Strip timestamp tokens from `chunk.text` immediately when extracting it from the model output, before it enters the pipeline:

```ts
const text = (chunk.text || '').replace(/<\|[\d.]+\|>/g, '').trim();
```

### 2. In `sanitizeSegments` (the existing sanitization layer)

Add a broader timestamp-stripping regex to `cleanMixedContent` that catches any format the model might produce:

- `<|0.00|>` — Whisper's native timestamp token format
- `[00:00.000]` or `(00:00.000)` — bracket/paren timestamp formats  
- Bare `0:00` or `00:00:00` patterns surrounded by spaces

Regex patterns to add:
```ts
/<\|[\d.]+\|>/g          // Whisper tokens: <|0.00|>
/\[?\d{1,2}:\d{2}(?:[:.]\d{1,3})?\]?/g  // [0:00.0] or bare 0:00 formats
```

The second pattern is applied carefully — only removing matches that look like timestamps (digits:digits with optional decimal), not arbitrary text.

### Files changed

**`src/lib/transcription.ts`** only — two small additions:
1. One `.replace()` call on line ~253 in `transcribeAudio`
2. Two regex patterns added to `cleanMixedContent` inside `sanitizeSegments`

No UI changes. No new files or dependencies.

