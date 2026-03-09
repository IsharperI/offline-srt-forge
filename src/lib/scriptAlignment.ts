import type { TranscriptSegment, WordTiming } from './transcription';

// ==========================================
// Normalization helpers
// ==========================================

const NUMBER_WORDS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen',
  '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen',
  '18': 'eighteen', '19': 'nineteen', '20': 'twenty', '30': 'thirty',
  '40': 'forty', '50': 'fifty', '60': 'sixty', '70': 'seventy',
  '80': 'eighty', '90': 'ninety', '100': 'hundred', '1000': 'thousand',
};

const WORD_NUMBERS: Record<string, string> = {};
for (const [k, v] of Object.entries(NUMBER_WORDS)) {
  WORD_NUMBERS[v] = k;
}

function stripPunctuation(word: string): string {
  return word.replace(/[^a-zA-Z0-9']/g, '');
}

function normalizeWord(word: string): string {
  let w = stripPunctuation(word).toLowerCase();
  // Normalize number to word form for comparison
  if (NUMBER_WORDS[w]) w = NUMBER_WORDS[w];
  return w;
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(w => w.length > 0);
}

// ==========================================
// Levenshtein distance for fuzzy matching
// ==========================================

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

function isSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;
  const dist = levenshtein(a, b);
  return dist <= Math.ceil(maxLen * 0.5);
}

// ==========================================
// Split script into sentences
// ==========================================

function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation, keeping non-empty results
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.map(s => s.trim()).filter(s => s.length > 0);
}

// ==========================================
// Find the best matching portion of script for a transcript
// ==========================================

export function findMatchingScriptPortion(
  transcriptText: string,
  fullScriptText: string
): { matchedPortion: string; matchPercentage: number; isValid: boolean } {
  const sentences = splitIntoSentences(fullScriptText);
  
  // If only one sentence or no sentence breaks, treat whole script as one portion
  if (sentences.length <= 1) {
    const validation = validateScriptMatch(transcriptText, fullScriptText);
    return { matchedPortion: fullScriptText, ...validation };
  }

  const transcriptWords = tokenize(transcriptText).map(normalizeWord).filter(w => w.length > 0);
  
  // Try all contiguous ranges of sentences, find the one with highest match
  let bestMatch = { startIdx: 0, endIdx: 0, matchPercentage: 0 };

  for (let start = 0; start < sentences.length; start++) {
    for (let end = start + 1; end <= Math.min(start + 5, sentences.length); end++) {
      const portion = sentences.slice(start, end).join(' ');
      const portionWords = tokenize(portion).map(normalizeWord).filter(w => w.length > 0);
      
      if (portionWords.length === 0) continue;

      // Sequential matching
      let tIdx = 0;
      let matches = 0;
      for (const sw of portionWords) {
        const windowEnd = Math.min(tIdx + 5, transcriptWords.length);
        for (let j = tIdx; j < windowEnd; j++) {
          if (isSimilar(transcriptWords[j], sw)) {
            matches++;
            tIdx = j + 1;
            break;
          }
        }
        if (tIdx < transcriptWords.length) tIdx = Math.max(tIdx, tIdx);
      }

      const pct = Math.round((matches / portionWords.length) * 100);
      if (pct > bestMatch.matchPercentage) {
        bestMatch = { startIdx: start, endIdx: end, matchPercentage: pct };
      }
    }
  }

  const matchedPortion = sentences.slice(bestMatch.startIdx, bestMatch.endIdx).join(' ');
  return {
    matchedPortion,
    matchPercentage: bestMatch.matchPercentage,
    isValid: bestMatch.matchPercentage >= 70,
  };
}

// ==========================================
// Validation: 70% match threshold (full script)
// ==========================================

export function validateScriptMatch(
  transcriptText: string,
  scriptText: string
): { isValid: boolean; matchPercentage: number } {
  const transcriptWords = tokenize(transcriptText).map(normalizeWord).filter(w => w.length > 0);
  const scriptWords = tokenize(scriptText).map(normalizeWord).filter(w => w.length > 0);

  if (scriptWords.length === 0) {
    return { isValid: false, matchPercentage: 0 };
  }

  let tIdx = 0;
  let matches = 0;

  for (const sw of scriptWords) {
    const windowEnd = Math.min(tIdx + 5, transcriptWords.length);
    let found = false;
    for (let j = tIdx; j < windowEnd; j++) {
      if (isSimilar(transcriptWords[j], sw)) {
        matches++;
        tIdx = j + 1;
        found = true;
        break;
      }
    }
    if (!found && tIdx < transcriptWords.length) {
      tIdx++;
    }
  }

  const matchPercentage = Math.round((matches / scriptWords.length) * 100);
  return { isValid: matchPercentage >= 70, matchPercentage };
}

// ==========================================
// Alignment: script words + transcript timing
// ==========================================

interface TimedWord {
  word: string;
  start: number;
  end: number;
}

function extractTimedWords(segments: TranscriptSegment[]): TimedWord[] {
  const result: TimedWord[] = [];
  for (const seg of segments) {
    if (seg.words && seg.words.length > 0) {
      for (const w of seg.words) {
        result.push({ word: w.word, start: w.start, end: w.end });
      }
    } else {
      // Fallback: split text and estimate timing
      const words = seg.text.split(/\s+/).filter(w => w.length > 0);
      const duration = seg.endTime - seg.startTime;
      const totalChars = words.reduce((s, w) => s + w.length, 0) || 1;
      let t = seg.startTime;
      for (const w of words) {
        const wDur = (w.length / totalChars) * duration;
        result.push({ word: w, start: t, end: t + wDur });
        t += wDur;
      }
    }
  }
  return result;
}

export function alignTranscriptToScript(
  segments: TranscriptSegment[],
  scriptText: string
): TranscriptSegment[] {
  const timedWords = extractTimedWords(segments);
  const scriptWords = tokenize(scriptText);

  if (timedWords.length === 0 || scriptWords.length === 0) {
    return segments;
  }

  // Align script words to timed words using sequential greedy matching
  const alignedWords: TimedWord[] = [];
  let tIdx = 0;

  for (let sIdx = 0; sIdx < scriptWords.length; sIdx++) {
    const sw = scriptWords[sIdx];
    const swNorm = normalizeWord(sw);

    if (tIdx >= timedWords.length) {
      // No more transcript words — interpolate timing from last known
      const lastTime = alignedWords.length > 0
        ? alignedWords[alignedWords.length - 1].end
        : (segments[segments.length - 1]?.endTime ?? 0);
      const gap = 0.3; // default word duration for extras
      alignedWords.push({ word: sw, start: lastTime, end: lastTime + gap });
      continue;
    }

    // Look ahead in transcript for best match (window of 5)
    const windowEnd = Math.min(tIdx + 5, timedWords.length);
    let bestJ = -1;
    for (let j = tIdx; j < windowEnd; j++) {
      const twNorm = normalizeWord(timedWords[j].word);
      if (isSimilar(twNorm, swNorm)) {
        bestJ = j;
        break;
      }
    }

    if (bestJ >= 0) {
      // Use script word with transcript timing
      alignedWords.push({
        word: sw,
        start: timedWords[bestJ].start,
        end: timedWords[bestJ].end,
      });
      tIdx = bestJ + 1;
    } else {
      // No match — interpolate timing between previous and current transcript word
      const prevEnd = alignedWords.length > 0
        ? alignedWords[alignedWords.length - 1].end
        : timedWords[tIdx].start;
      const nextStart = timedWords[tIdx].start;
      const midTime = (prevEnd + nextStart) / 2;
      const gap = Math.max(0.15, (nextStart - prevEnd) / 2);
      alignedWords.push({
        word: sw,
        start: Math.max(prevEnd, midTime - gap / 2),
        end: Math.min(nextStart, midTime + gap / 2),
      });
    }
  }

  // Group aligned words back into segments, preserving roughly the original segment boundaries
  const result: TranscriptSegment[] = [];
  if (alignedWords.length === 0) return segments;

  // Use original segment boundaries as guides
  const segBoundaries = segments.map(s => s.endTime);
  let wordIdx = 0;
  let segIdx = 0;

  while (wordIdx < alignedWords.length) {
    const segEnd = segIdx < segBoundaries.length
      ? segBoundaries[segIdx]
      : Infinity;

    const segWords: TimedWord[] = [];
    while (wordIdx < alignedWords.length && alignedWords[wordIdx].start < segEnd) {
      segWords.push(alignedWords[wordIdx]);
      wordIdx++;
    }

    if (segWords.length > 0) {
      const wordTimings: WordTiming[] = segWords.map(w => ({
        word: w.word,
        start: w.start,
        end: w.end,
      }));
      result.push({
        startTime: segWords[0].start,
        endTime: segWords[segWords.length - 1].end,
        text: segWords.map(w => w.word).join(' '),
        words: wordTimings,
      });
    }

    segIdx++;
    if (segIdx > segBoundaries.length && wordIdx < alignedWords.length) {
      // Remaining words in one final segment
      const remaining = alignedWords.slice(wordIdx);
      const wordTimings: WordTiming[] = remaining.map(w => ({
        word: w.word, start: w.start, end: w.end,
      }));
      result.push({
        startTime: remaining[0].start,
        endTime: remaining[remaining.length - 1].end,
        text: remaining.map(w => w.word).join(' '),
        words: wordTimings,
      });
      break;
    }
  }

  return result;
}
