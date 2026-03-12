

# Fix: Malformed SRT Timestamps (4-digit milliseconds)

## Problem

The screenshot shows `00:01:11,1000` — a 4-digit millisecond value. SRT format requires exactly 3-digit milliseconds (000–999). This is a math bug, not a model issue.

## Root Cause

In `generateSRT` (line 708):
```ts
const millis = Math.round((seconds % 1) * 1000);
```

When `seconds` has a fractional part very close to 1.0 (e.g., `71.9997`), `Math.round` produces `1000`. This creates an invalid timestamp like `00:01:11,1000`.

## Fix — `src/lib/transcription.ts`, line 704–710

Replace the `formatTime` function to handle the millisecond overflow by rolling it into the seconds value:

```ts
const formatTime = (seconds: number): string => {
  let totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3600000);
  totalMs %= 3600000;
  const minutes = Math.floor(totalMs / 60000);
  totalMs %= 60000;
  const secs = Math.floor(totalMs / 1000);
  const millis = totalMs % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
};
```

By rounding to total milliseconds first, then decomposing into h/m/s/ms via integer division, the overflow is impossible. One change, one file, no new dependencies.

