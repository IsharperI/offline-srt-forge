/**
 * Utilities for aligning transcribed text to a reference script.
 *
 * This module currently exposes low-level helpers (text cleaning and
 * phonetic-style similarity scoring). A higher-level alignment function
 * will be added in a later step.
 */

export interface CleanedText {
  /** Lowercased, punctuation-stripped text suitable for comparison. */
  normalized: string;
  /** Tokenized normalized words (lowercase, no punctuation except apostrophes). */
  normalizedWords: string[];
  /**
   * Tokenized words preserving the original casing and punctuation from the
   * input. Indices line up 1:1 with `normalizedWords` so a match against the
   * normalized form can be substituted using the original-cased token.
   */
  originalWords: string[];
}

/**
 * Clean a string for comparison while preserving the original casing/tokens
 * in a parallel array so callers can substitute using the source's casing.
 *
 * - Normalizes whitespace and trims.
 * - Lowercases only for the comparison form.
 * - Removes punctuation except apostrophes (so contractions stay intact).
 */
export function cleanText(input: string): CleanedText {
  const collapsed = (input ?? "").replace(/\s+/g, " ").trim();

  if (!collapsed) {
    return { normalized: "", normalizedWords: [], originalWords: [] };
  }

  const originalWords = collapsed.split(" ");

  const normalizedWords = originalWords
    .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ""))
    .filter((w) => w.length > 0);

  // Re-derive originalWords aligned to non-empty normalized tokens.
  const alignedOriginalWords: string[] = [];
  for (const w of originalWords) {
    const norm = w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
    if (norm.length > 0) alignedOriginalWords.push(w);
  }

  return {
    normalized: normalizedWords.join(" "),
    normalizedWords,
    originalWords: alignedOriginalWords,
  };
}

/** Generate character bigrams for a word. Single-char words return [word]. */
function bigrams(word: string): string[] {
  if (word.length <= 1) return [word];
  const out: string[] = [];
  for (let i = 0; i < word.length - 1; i++) {
    out.push(word.slice(i, i + 2));
  }
  return out;
}

/** Strip a trailing apostrophe-s or trailing s/es for plural-ish comparison. */
function stripPlural(word: string): string {
  return word
    .replace(/'s$/i, "")
    .replace(/es$/i, "")
    .replace(/s$/i, "");
}

/** Remove all apostrophes (handle "dont" vs "don't"). */
function stripApostrophes(word: string): string {
  return word.replace(/'/g, "");
}

/**
 * Score how similar two words sound / look on a 0..1 scale.
 *
 *  - 1.0   : exact case-insensitive match.
 *  - >=0.9 : differ only by common transcription artifacts
 *            (plural s/es, missing apostrophe, etc.).
 *  - else  : character bigram (Dice) overlap, with a small-word fallback.
 *  - 0     : nothing in common.
 */
export function phoneticSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const x = a.toLowerCase();
  const y = b.toLowerCase();

  if (x === y) return 1.0;

  // Apostrophe-only differences ("dont" vs "don't").
  if (stripApostrophes(x) === stripApostrophes(y)) return 0.95;

  // Plural / possessive differences ("cats" vs "cat", "boss" vs "bosses").
  if (
    stripPlural(x) === stripPlural(y) ||
    stripPlural(x) === y ||
    x === stripPlural(y)
  ) {
    return 0.9;
  }

  // Substring containment (e.g. "walmarta" vs "wmata" is not substring, but
  // "wmatax" vs "wmata" is).
  if (x.includes(y) || y.includes(x)) return 0.85;

  // Subsequence: shorter word's characters all appear in order within longer.
  const [shorter, longer] = x.length < y.length ? [x, y] : [y, x];
  let si = 0;
  for (const c of longer) {
    if (c === shorter[si]) si++;
    if (si === shorter.length) break;
  }
  if (si === shorter.length) return 0.82;

  // Same first & last character and within 4 characters in length.
  if (
    x[0] === y[0] &&
    x[x.length - 1] === y[y.length - 1] &&
    Math.abs(x.length - y.length) <= 4
  ) {
    return 0.78;
  }

  // For very short tokens (acronyms, initials, short names), bigram overlap is
  // unreliable. Fall back to a character-set Jaccard score.
  if (x.length <= 3 || y.length <= 3) {
    const setX = new Set(x);
    const setY = new Set(y);
    let inter = 0;
    for (const c of setX) if (setY.has(c)) inter++;
    const union = new Set([...setX, ...setY]).size;
    if (union === 0) return 0;
    const jacc = inter / union;
    // Require at least one shared character; otherwise treat as dissimilar.
    return inter === 0 ? 0 : jacc;
  }

  // Dice coefficient over character bigrams.
  const bx = bigrams(x);
  const by = bigrams(y);

  const counts = new Map<string, number>();
  for (const g of bx) counts.set(g, (counts.get(g) ?? 0) + 1);

  let matches = 0;
  for (const g of by) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      matches++;
      counts.set(g, c - 1);
    }
  }

  if (matches === 0) return 0;
  return (2 * matches) / (bx.length + by.length);
}

/**
 * Minimum similarity score required to substitute a script word in place
 * of a transcribed word during alignment.
 */
export const CONFIDENCE_THRESHOLD = 0.75;

/** A single word token from the reference script. */
export interface ScriptToken {
  /** Exact word as it appears in the script (preserves casing/acronyms). */
  original: string;
  /** Lowercase, punctuation-stripped form (apostrophes preserved) for comparison. */
  normalized: string;
  /** Position in the script word array. */
  index: number;
}

/**
 * Tokenize a raw script string into ScriptToken objects, one per word.
 * Preserves the original casing/punctuation in `original` and produces a
 * comparison-friendly form in `normalized`.
 */
export function tokenizeScript(script: string): ScriptToken[] {
  const collapsed = (script ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return [];

  const rawWords = collapsed.split(" ");
  const tokens: ScriptToken[] = [];
  let idx = 0;
  for (const w of rawWords) {
    const normalized = w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
    if (!normalized) continue;
    tokens.push({ original: w, normalized, index: idx });
    idx++;
  }
  return tokens;
}

/** Result of locating the best-matching window of script tokens. */
export interface WindowResult {
  /** Index into scriptTokens where the best match begins (inclusive). */
  startIndex: number;
  /** Index into scriptTokens where the best match ends (inclusive). */
  endIndex: number;
  /** 0..1 share of transcribed words that confidently matched. */
  matchRate: number;
}

/**
 * Slide a window over `scriptTokens` (size = transcribedWords.length * 1.5)
 * and return the window whose script tokens best cover the transcription.
 *
 * Scoring: for each transcribed word, find the highest phoneticSimilarity
 * against any script token within the window; count it as a match if that
 * score is >= CONFIDENCE_THRESHOLD. matchRate = matches / transcribedWords.
 */
export function findBestWindow(
  transcribedWords: string[],
  scriptTokens: ScriptToken[]
): WindowResult {
  if (scriptTokens.length === 0 || transcribedWords.length === 0) {
    return { startIndex: 0, endIndex: 0, matchRate: 0 };
  }

  const normalizedTranscribed = transcribedWords
    .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ""))
    .filter((w) => w.length > 0);

  if (normalizedTranscribed.length === 0) {
    return { startIndex: 0, endIndex: 0, matchRate: 0 };
  }

  const windowSize = Math.min(
    scriptTokens.length,
    Math.max(1, Math.ceil(transcribedWords.length * 1.5))
  );
  const lastStart = scriptTokens.length - windowSize;

  let bestStart = 0;
  let bestMatches = -1;

  for (let start = 0; start <= lastStart; start++) {
    const end = start + windowSize; // exclusive
    let matches = 0;
    for (const tw of normalizedTranscribed) {
      let bestSim = 0;
      for (let j = start; j < end; j++) {
        const sim = phoneticSimilarity(tw, scriptTokens[j].normalized);
        if (sim > bestSim) {
          bestSim = sim;
          if (bestSim === 1) break;
        }
      }
      if (bestSim >= CONFIDENCE_THRESHOLD) matches++;
    }
    if (matches > bestMatches) {
      bestMatches = matches;
      bestStart = start;
    }
  }

  const endIndex = Math.min(
    scriptTokens.length - 1,
    bestStart + windowSize - 1
  );
  return {
    startIndex: bestStart,
    endIndex,
    matchRate: Math.max(0, bestMatches) / normalizedTranscribed.length,
  };
}

import type { TranscriptSegment } from "./transcription";

/** Result of aligning a transcription against a reference script. */
export interface AlignmentResult {
  /** Corrected segments. Original timings (startTime/endTime) are preserved. */
  segments: TranscriptSegment[];
  /** 0..1 overall alignment confidence from findBestWindow. */
  matchRate: number;
  /** True when matchRate >= 0.75. */
  scriptWasUseful: boolean;
}

/**
 * Align transcribed segments to a reference script, substituting
 * confidently-matched words with the script's original casing while
 * preserving every segment's timing fields.
 */
export function alignTranscriptionToScript(
  segments: TranscriptSegment[],
  scriptText: string
): AlignmentResult {
  if (!scriptText || !scriptText.trim()) {
    return { segments, matchRate: 0, scriptWasUseful: false };
  }

  const scriptTokens = tokenizeScript(scriptText);
  if (scriptTokens.length === 0) {
    return { segments, matchRate: 0, scriptWasUseful: false };
  }

  // Flatten all transcribed words across segments.
  const transcribedWords: string[] = [];
  for (const seg of segments) {
    for (const w of (seg.text ?? "").split(/\s+/)) {
      if (w) transcribedWords.push(w);
    }
  }

  if (transcribedWords.length === 0) {
    return { segments, matchRate: 0, scriptWasUseful: false };
  }

  const window = findBestWindow(transcribedWords, scriptTokens);
  const windowTokens = scriptTokens.slice(
    window.startIndex,
    window.endIndex + 1
  );

  if (windowTokens.length === 0) {
    return {
      segments,
      matchRate: window.matchRate,
      scriptWasUseful: window.matchRate >= 0.75,
    };
  }

  // Walk segments, substituting words confidently matched within the window.
  // We advance a cursor through the window so substitutions stay roughly in order.
  let cursor = 0;
  const SEARCH_RADIUS = 8;

  const correctedSegments: TranscriptSegment[] = segments.map((seg) => {
    const rawWords = (seg.text ?? "").split(/(\s+)/); // keep whitespace tokens

    const newParts = rawWords.map((part) => {
      if (!part || /^\s+$/.test(part)) return part;

      // Strip leading/trailing punctuation for comparison; preserve them on output.
      const leadMatch = part.match(/^[^\p{L}\p{N}']+/u);
      const trailMatch = part.match(/[^\p{L}\p{N}']+$/u);
      const lead = leadMatch ? leadMatch[0] : "";
      const trail = trailMatch ? trailMatch[0] : "";
      const core = part.slice(lead.length, part.length - trail.length);
      const normCore = core.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

      if (!normCore) return part;

      const from = Math.max(0, cursor - SEARCH_RADIUS);
      const to = Math.min(windowTokens.length, cursor + SEARCH_RADIUS + 1);

      let bestSim = 0;
      let bestIdx = -1;
      for (let i = from; i < to; i++) {
        const sim = phoneticSimilarity(normCore, windowTokens[i].normalized);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
          if (sim === 1) break;
        }
      }

      if (bestIdx >= 0 && bestSim >= CONFIDENCE_THRESHOLD) {
        cursor = bestIdx + 1;
        return `${lead}${windowTokens[bestIdx].original}${trail}`;
      }

      return part;
    });

    // Preserve every timing-related field; only replace `text`.
    return { ...seg, text: newParts.join("") };
  });

  return {
    segments: correctedSegments,
    matchRate: window.matchRate,
    scriptWasUseful: window.matchRate >= 0.75,
  };
}
