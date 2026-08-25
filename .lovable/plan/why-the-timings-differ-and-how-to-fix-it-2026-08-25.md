# Why the timings differ — and how to fix it

## What the two files show

Comparing your manual VTT to the app's SRT, the differences are not random model drift. They cluster at two exact points:

| Time | Manual VTT | App SRT |
|---|---|---|
| ~24.5–31.2s | "grandes diferenças de temperatura entre as condições ambientais e criogênicas" | "…relacionada à tubulação **entre** / as condições ambientais e criogênicas" — the phrase "grandes diferenças de temperatura" is missing |
| ~47.3–50.2s | "Dispositivos de alívio de pressão / devem ser instalados na tubulação em todos os pontos onde o hidrogênio líquido possa ficar retido." | caption 10 is "criogênicas. líquido possa ficar retido." spanning 46.1 → 58.3 (12.2s) |

25s and 50s are exactly the app's internal window boundaries. That is the cause, not the model.

## Root cause

The transcriber cuts the audio into fixed 25-second windows, transcribes each with 1.5s of padding on both sides for context, then keeps only the segments that fall fully inside the un-padded 25s window.

A phrase that *straddles* a boundary gets rejected twice:
- In window N it is discarded because its end time falls past the window end.
- In window N+1 it is discarded because its start time falls before the window start.

So the words spoken across the 25s and 50s marks vanish. The 12.2-second caption 10 is a downstream symptom: with the middle text gone, the remaining fragments get bridged across the resulting silence gap.

A second, smaller source of drift: word-level times are *estimated* by splitting each Whisper segment proportionally to character count. So when a caption is re-split to fit the character limit, the split time is interpolated rather than measured — this is why boundaries like 5.547 vs 7.107 differ by a second or two even where the text matches.

## Fix

1. Replace the "drop anything crossing the edge" rule with a claim-by-midpoint rule: a segment belongs to the window whose range contains the segment's midpoint. Boundary-crossing speech is then kept exactly once, with its real (padded-slice) timings, instead of being dropped by both windows.
2. Add a de-duplication pass after all windows are merged: if two consecutive segments overlap in time and share the same leading/trailing text, keep the longer/earlier one. This guards against the same phrase being emitted by both windows when a midpoint lands near the edge.
3. Only bridge a silence gap onto the previous caption when the gap is short (e.g. under 2s). Longer gaps stay as real gaps, so a missing chunk can never inflate a caption to 12 seconds.

## Technical notes

All changes are in `src/lib/transcription.ts`:
- `transcribeAudio` — the window loop's keep/discard condition (currently `if (sliceStart < padOffset || sliceEnd > trueLength + padOffset) continue;`) becomes a midpoint test against the window range.
- New helper after the window loop to drop overlapping duplicate segments.
- `sanitizeSegments` — the silence gap-filling branch gets a maximum bridge duration.

No changes to models, settings, or UI. Word timings stay character-estimated; sub-second split drift will remain until real word-level timestamps are enabled, which is a separate change.
