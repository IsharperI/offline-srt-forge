
# Semantic Caption Segmentation Refinement

## What Changes

The caption segmentation logic in `src/lib/transcription.ts` will be rewritten to follow a smarter, semantic-first approach rather than simply filling lines up to the character limit.

## New Break Priority System

The current `processWordsIntoSegments` and `findBestBreakPoint` functions will be replaced with a new algorithm that follows these priorities (highest to lowest):

1. **Punctuation Priority** -- Always break immediately after `.` `?` `!`, even if the segment is short (e.g., 20 characters). This ensures each sentence gets its own caption block.

2. **Clause Breaks** -- For long sentences without terminal punctuation yet, prefer breaking after commas `,`, semicolons `;`, or dashes `--`/`-`.

3. **Logical Conjunctions** -- If no punctuation break is available and the text exceeds ~45-50 characters, break before conjunctions (`and`, `but`, `or`, `so`) or prepositions (`to`, `for`, `with`, `on`, etc.).

4. **Balance Rule** -- When a sentence must be split and multiple break points are available, choose the one that produces the most balanced segment lengths (closest to 50/50 split) rather than maximizing the first segment.

5. **No Orphans** -- A caption line must never end with a single dangling word or a lone preposition. The 3-word minimum rule and standalone interjection exceptions remain unchanged.

The user's "Max characters per caption" setting remains the hard upper limit -- no segment can exceed it.

## Technical Details

### Changes to `src/lib/transcription.ts`

**New constant:**
- `SOFT_BREAK_THRESHOLD = 45` -- the character count at which we start looking for conjunction/preposition breaks even without punctuation.

**New helper: `endsWithClauseBreak(word)`**
- Returns true if a word ends with `,`, `;`, or `--`.

**Rewritten `processWordsIntoSegments(words, maxLength)`:**
- Scans words sequentially, building up a candidate segment.
- On encountering sentence-ending punctuation (`.!?`): immediately finalize the segment (even if short), as long as the 3-word minimum is met.
- On encountering a clause break (`,;--`): record it as a candidate break point.
- On exceeding `SOFT_BREAK_THRESHOLD` (~45 chars): start tracking conjunction/preposition break points.
- On approaching `maxLength`: select the best available break point using the priority order above.
- **Balance logic**: When multiple break candidates exist, score them by how close to a 50/50 split they produce and pick the most balanced option.

**Rewritten `findBestBreakPoint(words, startIdx, endIdx, maxLength)`:**
- Collects all candidate break points (punctuation, clause, conjunction) with their indices.
- Scores each candidate by balance (how evenly it splits remaining text).
- Returns the highest-priority, most-balanced break.

**Anti-orphan check added to break selection:**
- Before finalizing a break, verify the resulting segment does not end with a single preposition. If it does, pull the preposition into the next segment.

**`applyAntiOrphanLogic` remains unchanged** -- it handles post-processing merges for segments under 3 words.

### No other files are changed.
This is purely a logic refinement within the existing segmentation pipeline. The UI, sanitization layer, and SRT export format are unaffected.
