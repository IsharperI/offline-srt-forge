import { pipeline, type AutomaticSpeechRecognitionOutput } from "@huggingface/transformers";

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  startTime: number;
  endTime: number;
  text: string;
  words?: WordTiming[]; // Word-level timing for accurate splitting
}

export interface TranscriptionProgress {
  status: 'loading' | 'transcribing' | 'processing' | 'complete' | 'error';
  progress: number;
  message: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;
let loadingPromise: Promise<void> | null = null;
let currentModelId: string | null = null;

const DEFAULT_MODEL = 'onnx-community/whisper-base.en';

const TRANSCRIPTION_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s: ${label}`)), ms)
    ),
  ]);
}

export function initializeTranscriber(
  onProgress?: (progress: TranscriptionProgress) => void,
  modelId: string = DEFAULT_MODEL
): Promise<void> {
  if (transcriber && currentModelId === modelId) return Promise.resolve();

  // If already loading the same model, share the in-flight promise
  if (loadingPromise) return loadingPromise;

  if (currentModelId !== modelId) {
    transcriber = null;
    currentModelId = null;
  }

  loadingPromise = (async () => {
    onProgress?.({ status: 'loading', progress: 0, message: `Loading model: ${modelId}...` });

    const result = await pipeline(
      "automatic-speech-recognition",
      modelId,
      {
        progress_callback: (data: { progress?: number; status?: string }) => {
          if (data.progress) {
            onProgress?.({
              status: 'loading',
              progress: Math.min(data.progress, 100),
              message: `Loading model: ${Math.round(data.progress)}%`
            });
          }
        }
      }
    );

    if (typeof result !== 'function') {
      console.error('Pipeline returned non-function:', typeof result, result);
      throw new Error('Model failed to initialize properly');
    }

    transcriber = result;
    currentModelId = modelId;
    console.log('Transcriber initialized successfully:', typeof transcriber, 'Model:', modelId);
    onProgress?.({ status: 'loading', progress: 100, message: 'Model loaded successfully' });
  })().finally(() => {
    loadingPromise = null;
  });

  return loadingPromise;
}

export function getCurrentModelId(): string | null {
  return currentModelId;
}

export function resetTranscriber(): void {
  transcriber = null;
  currentModelId = null;
}

function estimateWordTimings(text: string, startTime: number, endTime: number): WordTiming[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];
  
  const totalDuration = endTime - startTime;
  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  
  const result: WordTiming[] = [];
  let currentTime = startTime;
  
  for (const word of words) {
    const wordDuration = (word.length / totalChars) * totalDuration;
    const wordEnd = currentTime + wordDuration;
    result.push({ word, start: currentTime, end: wordEnd });
    currentTime = wordEnd;
  }
  
  return result;
}

async function addInaudibleNoise(audioBuffer: ArrayBuffer): Promise<Blob> {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  try {
    const decodedAudio = await audioContext.decodeAudioData(audioBuffer.slice(0));
    const numberOfChannels = decodedAudio.numberOfChannels;
    const sampleRate = decodedAudio.sampleRate;
    const length = decodedAudio.length;
    
    const offlineContext = new OfflineAudioContext(numberOfChannels, length, sampleRate);
    const outputBuffer = offlineContext.createBuffer(numberOfChannels, length, sampleRate);
    
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const inputData = decodedAudio.getChannelData(channel);
      const outputData = outputBuffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const noise = (Math.random() * 2 - 1) * 0.001;
        outputData[i] = inputData[i] + noise;
      }
    }
    
    return encodeWAV(outputBuffer);
  } finally {
    await audioContext.close();
  }
}

function encodeWAV(audioBuffer: AudioBuffer): Blob {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  
  const interleaved = new Float32Array(length * numberOfChannels);
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      interleaved[i * numberOfChannels + channel] = channelData[i];
    }
  }
  
  const buffer = new ArrayBuffer(44 + interleaved.length * 2);
  const view = new DataView(buffer);
  
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + interleaved.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numberOfChannels * 2, true);
  view.setUint16(32, numberOfChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, interleaved.length * 2, true);
  
  let offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function transcribeAudio(
  audioFile: File,
  onProgress?: (progress: TranscriptionProgress) => void,
  modelId?: string,
  audioDuration?: number,
  scriptText?: string
): Promise<TranscriptSegment[]> {
  const targetModel = modelId || 'onnx-community/whisper-tiny.en';
  
  if (!transcriber || typeof transcriber !== 'function' || currentModelId !== targetModel) {
    transcriber = null;
    await initializeTranscriber(onProgress, targetModel);
  }
  
  if (typeof transcriber !== 'function') {
    throw new Error('Failed to initialize transcription model');
  }
  
  onProgress?.({ status: 'transcribing', progress: 0, message: 'Processing audio...' });
  
  const arrayBuffer = await audioFile.arrayBuffer();
  
  if (arrayBuffer.byteLength === 0) {
    throw new Error('Audio file is empty');
  }
  
  console.log(`Processing file: ${audioFile.name}, size: ${arrayBuffer.byteLength} bytes, type: ${audioFile.type}`);
  
  onProgress?.({ status: 'transcribing', progress: 5, message: 'Adding noise floor...' });
  
  let processedBlob: Blob;
  try {
    processedBlob = await addInaudibleNoise(arrayBuffer);
    console.log('Added inaudible noise floor to audio');
  } catch (noiseError) {
    console.warn('Could not add noise, using original audio:', noiseError);
    processedBlob = new Blob([arrayBuffer], { type: audioFile.type || 'audio/wav' });
  }
  
  const audioUrl = URL.createObjectURL(processedBlob);
  
  // Build an initial prompt for Whisper from the first ~250 words of the script.
  // @huggingface/transformers v3 exposes WhisperTokenizer.get_prompt_ids which
  // returns the token IDs to feed via generation_kwargs.prompt_ids.
  let promptIds: unknown = null;
  if (scriptText && scriptText.trim()) {
    try {
      const words = scriptText.trim().split(/\s+/).slice(0, 250);
      const promptText = words.join(' ');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenizer: any = (transcriber as any)?.tokenizer;
      if (tokenizer && typeof tokenizer.get_prompt_ids === 'function') {
        promptIds = await tokenizer.get_prompt_ids(promptText);
        console.log('[Whisper] Using initial prompt from script:', promptText.slice(0, 120) + (promptText.length > 120 ? '…' : ''));
      } else {
        console.warn('[Whisper] tokenizer.get_prompt_ids unavailable on installed @huggingface/transformers; skipping initial prompt');
      }
    } catch (err) {
      console.warn('[Whisper] Failed to build prompt_ids from script:', err);
      promptIds = null;
    }
  }
  
  try {
    onProgress?.({ status: 'transcribing', progress: 10, message: 'Transcribing audio...' });
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callOpts: any = {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 3,
    };
    if (promptIds) {
      callOpts.generation_kwargs = { prompt_ids: promptIds };
      // Some versions read prompt_ids at the top level instead.
      callOpts.prompt_ids = promptIds;
    }
    
    const result = await withTimeout(
      transcriber!(audioUrl, callOpts) as Promise<AutomaticSpeechRecognitionOutput>,
      TRANSCRIPTION_TIMEOUT_MS,
      audioFile.name
    );
    
    console.log('Transcription result:', result);
    
    onProgress?.({ status: 'processing', progress: 80, message: 'Processing transcription...' });
    
    const segments: TranscriptSegment[] = [];
    
    if (result.chunks && Array.isArray(result.chunks)) {
      for (const chunk of result.chunks) {
        if (chunk.timestamp && Array.isArray(chunk.timestamp)) {
          const [start, end] = chunk.timestamp;
          const text = (chunk.text || '').replace(/<\|[\d.]+\|>/g, '').trim();
          if (text) {
            const startTime = typeof start === 'number' ? start : 0;
            const chunkIndex = result.chunks.indexOf(chunk);
            const nextChunk = result.chunks[chunkIndex + 1];
            const endTime = typeof end === 'number'
              ? end
              : (typeof nextChunk?.timestamp?.[0] === 'number'
                ? nextChunk.timestamp[0]
                : (typeof audioDuration === 'number' ? audioDuration : startTime + 2));
            const words = estimateWordTimings(text, startTime, endTime);
            segments.push({ startTime, endTime, text, words });
          }
        }
      }
    } else if (result.text) {
      const words = estimateWordTimings(result.text.trim(), 0, 30);
      segments.push({ startTime: 0, endTime: 30, text: result.text.trim(), words });
    }
    
    if (segments.length === 0) {
      console.warn('No segments extracted from transcription result');
    }
    
    onProgress?.({ status: 'complete', progress: 100, message: 'Transcription complete' });
    return segments;
  } catch (error) {
    console.error('Transcription error details:', error);
    throw error;
  } finally {
    URL.revokeObjectURL(audioUrl);
  }
}

// Step B: Sanitization Layer
export function sanitizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const silencePatterns = [
    /^\s*\[silence\.?\]\s*$/i,
    /^\s*\(silence\.?\)\s*$/i,
    /^\s*\[blank_audio\.?\]\s*$/i,
    /^\s*\(blank_audio\.?\)\s*$/i,
    /^\s*\[blank audio\.?\]\s*$/i,
    /^\s*\(blank audio\.?\)\s*$/i,
    /^\s*\[inaudible\.?\]\s*$/i,
    /^\s*\(inaudible\.?\)\s*$/i,
    /^\s*\[music\.?\]\s*$/i,
    /^\s*\(music\.?\)\s*$/i,
    /^\s*\[noise\.?\]\s*$/i,
    /^\s*\(noise\.?\)\s*$/i,
    /^\s*\[applause\.?\]\s*$/i,
    /^\s*\(applause\.?\)\s*$/i,
    /^\s*\[laughter\.?\]\s*$/i,
    /^\s*\(laughter\.?\)\s*$/i,
    /^\s*\.\s*$/,
    /^\s*$/,
  ];
  
  const cleanPatterns = [
    /\[silence\.?\]/gi,
    /\(silence\.?\)/gi,
    /\[blank_audio\.?\]/gi,
    /\(blank_audio\.?\)/gi,
    /\[blank audio\.?\]/gi,
    /\(blank audio\.?\)/gi,
    /\[inaudible\.?\]/gi,
    /\(inaudible\.?\)/gi,
    /\[music\.?\]/gi,
    /\(music\.?\)/gi,
    /\[noise\.?\]/gi,
    /\(noise\.?\)/gi,
    /\[applause\.?\]/gi,
    /\(applause\.?\)/gi,
    /\[laughter\.?\]/gi,
    /\(laughter\.?\)/gi,
  ];
  
  const isSilenceOnly = (text: string): boolean => {
    return silencePatterns.some(pattern => pattern.test(text));
  };
  
  const cleanMixedContent = (text: string): string => {
    let cleaned = text;
    // Strip Whisper timestamp tokens: <|0.00|>
    cleaned = cleaned.replace(/<\|[\d.]+\|>/g, '');
    // Strip bracketed/bare timestamp formats: [00:00.000], 0:00, 00:00:00
    cleaned = cleaned.replace(/\[?\d{1,2}:\d{2}(?:[:.]\d{1,3})?\]?/g, '');
    for (const pattern of cleanPatterns) {
      cleaned = cleaned.replace(pattern, '').trim();
    }
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
  };
  
  const result: TranscriptSegment[] = [];
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    if (isSilenceOnly(segment.text)) {
      if (result.length > 0) {
        let nextNonSilenceIndex = -1;
        for (let j = i + 1; j < segments.length; j++) {
          if (!isSilenceOnly(segments[j].text)) {
            nextNonSilenceIndex = j;
            break;
          }
        }
        if (nextNonSilenceIndex !== -1) {
          result[result.length - 1].endTime = segments[nextNonSilenceIndex].startTime;
        }
      }
      continue;
    }
    
    const cleanedText = cleanMixedContent(segment.text);
    if (!cleanedText) continue;
    
    result.push({
      startTime: segment.startTime,
      endTime: segment.endTime,
      text: cleanedText,
      words: segment.words,
    });
  }
  
  return result;
}

// ==========================================
// Step C: Caption Segmentation & SRT Generation
// ==========================================

const DEFAULT_MAX_LINE_LENGTH = 80;
const MIN_WORDS_PER_SEGMENT = 3;
const SOFT_BREAK_THRESHOLD = 45;

// Duration targets for captions (seconds)
const MAX_SEGMENT_DURATION = 5.0;
const MIN_SEGMENT_DURATION = 1.5;
const SILENCE_GAP_THRESHOLD = 0.4;

// Conjunctions and prepositions to break BEFORE
const BREAK_BEFORE_WORDS = new Set([
  'and', 'but', 'so', 'because', 'or', 'yet', 'nor',
  'for', 'in', 'on', 'at', 'to', 'with', 'from', 'by',
  'of', 'about', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'between', 'under', 'over',
  'while', 'although', 'though', 'unless', 'until', 'when',
  'where', 'if', 'then', 'than', 'as', 'since', 'that', 'which'
]);

// Words that should NEVER end a caption (would split subject/verb,
// determiner/noun, auxiliary/main-verb, etc.). Only applied when the
// word has no trailing punctuation that would close the phrase.
const NO_BREAK_AFTER_WORDS = new Set([
  // articles & determiners
  'a', 'an', 'the',
  // possessives
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  // demonstratives
  'this', 'that', 'these', 'those',
  // subject pronouns (avoid splitting subject from verb)
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  // auxiliaries / modals (avoid splitting from main verb)
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must',
  // negation that pairs with following verb
  'not', "don't", "doesn't", "didn't", "won't", "wouldn't",
  "can't", "couldn't", "shouldn't", "isn't", "aren't", "wasn't", "weren't",
  // quantifiers/adjectives that typically precede a noun
  'some', 'any', 'no', 'every', 'each', 'all', 'most', 'many', 'few', 'several',
  'one', 'two', 'three', 'four', 'five',
]);

// Short standalone interjections that should NOT be merged
const STANDALONE_INTERJECTIONS = new Set([
  'no.', 'yes.', 'no!', 'yes!', 'ok.', 'okay.',
  'yes, sir.', 'no, sir.', 'yes, ma\'am.', 'no, ma\'am.',
  'right.', 'sure.', 'fine.', 'thanks.', 'please.',
  'wow.', 'oh.', 'ah.', 'hmm.', 'well.',
]);

interface CaptionSegment {
  text: string;
  start: number;
  end: number;
}

// Check if a word ends with sentence-ending punctuation
function endsSentence(word: string): boolean {
  return /[.!?]$/.test(word);
}

// Check if a word ends with a clause break (comma, semicolon, or dash)
function endsWithClauseBreak(word: string): boolean {
  return /[,;]$/.test(word) || word.endsWith('--') || /[^-]-$/.test(word);
}

// Check if text is a standalone interjection
function isStandaloneInterjection(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return STANDALONE_INTERJECTIONS.has(normalized);
}

// Check if a word is a conjunction/preposition (for orphan check)
function isPrepositionOrConjunction(word: string): boolean {
  return BREAK_BEFORE_WORDS.has(word.toLowerCase().replace(/[.,!?;:]+$/, ''));
}

// A word that grammatically binds to what follows (article, possessive,
// auxiliary, subject pronoun, etc.). A break right after it would split
// a subject from its verb or a determiner from its noun.
function isNoBreakAfter(word: string): boolean {
  // If the word carries closing punctuation, the phrase has already closed.
  if (/[.!?,;:]$/.test(word)) return false;
  const stripped = word.toLowerCase().replace(/[.,!?;:"')\]]+$/, '');
  return NO_BREAK_AFTER_WORDS.has(stripped);
}


// Calculate the text length for a range of words
function wordsTextLength(words: WordTiming[], startIdx: number, endIdx: number): number {
  let len = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    if (i > startIdx) len += 1; // space
    len += words[i].word.length;
  }
  return len;
}

interface BreakCandidate {
  index: number; // the index at which the segment ends
  priority: number; // 1 = punctuation (highest), 2 = clause, 3 = conjunction
}

// Find the best break point using semantic priority + balance scoring
function findBestBreakPoint(
  words: WordTiming[],
  startIdx: number,
  maxLength: number
): number {
  const candidates: BreakCandidate[] = [];
  let currentLength = 0;

  for (let i = startIdx; i < words.length; i++) {
    const addLength = (i === startIdx ? 0 : 1) + words[i].word.length;

    if (currentLength + addLength > maxLength && i > startIdx) {
      break;
    }

    currentLength += addLength;
    const wordCount = i - startIdx + 1;

    if (wordCount < MIN_WORDS_PER_SEGMENT) continue;

    // Grammar guard: skip candidates that would end on a word grammatically
    // bound to the following one (article, possessive, auxiliary, subject pronoun).
    const wordHere = words[i].word;
    const isGrammarUnsafe = isNoBreakAfter(wordHere);

    // Priority 1: Sentence-ending punctuation
    if (endsSentence(wordHere)) {
      candidates.push({ index: i, priority: 1 });
    }
    // Priority 2: Clause breaks (comma, semicolon, dash)
    else if (endsWithClauseBreak(wordHere)) {
      candidates.push({ index: i, priority: 2 });
    }
    // Priority 3: Before a conjunction/preposition (only after SOFT_BREAK_THRESHOLD)
    else if (
      i + 1 < words.length &&
      BREAK_BEFORE_WORDS.has(words[i + 1].word.toLowerCase().replace(/[.,!?;:]+$/, '')) &&
      currentLength >= SOFT_BREAK_THRESHOLD &&
      !isGrammarUnsafe
    ) {
      candidates.push({ index: i, priority: 3 });
    }
  }

  // No candidates: break at last grammatically-safe word that fits
  if (candidates.length === 0) {
    let lastFit = startIdx;
    let lastSafe = -1;
    let len = 0;
    for (let i = startIdx; i < words.length; i++) {
      const addLen = (i === startIdx ? 0 : 1) + words[i].word.length;
      if (len + addLen > maxLength && i > startIdx) break;
      len += addLen;
      lastFit = i;
      if (!isNoBreakAfter(words[i].word) && (i - startIdx + 1) >= MIN_WORDS_PER_SEGMENT) {
        lastSafe = i;
      }
    }
    return lastSafe >= 0 ? lastSafe : lastFit;
  }

  const bestPriority = Math.min(...candidates.map(c => c.priority));

  // For sentence-ending punctuation, take the last one (complete the sentence)
  if (bestPriority === 1) {
    const punctuationCandidates = candidates.filter(c => c.priority === 1);
    return punctuationCandidates[punctuationCandidates.length - 1].index;
  }

  // For clause/conjunction breaks, apply balance scoring
  const samePriorityCandidates = candidates.filter(c => c.priority === bestPriority);

  // Look ahead ~2 segments for balance scoring
  let totalFitEnd = startIdx;
  let totalFitLength = 0;
  for (let i = startIdx; i < words.length; i++) {
    const addLen = (i === startIdx ? 0 : 1) + words[i].word.length;
    if (totalFitLength + addLen > maxLength * 2) break;
    totalFitLength += addLen;
    totalFitEnd = i;
  }

  let bestCandidate = samePriorityCandidates[0];
  let bestBalanceScore = Infinity;

  for (const candidate of samePriorityCandidates) {
    const firstLen = wordsTextLength(words, startIdx, candidate.index);
    const secondLen = wordsTextLength(words, candidate.index + 1, totalFitEnd);
    const imbalance = Math.abs(firstLen - secondLen);

    if (imbalance < bestBalanceScore) {
      bestBalanceScore = imbalance;
      bestCandidate = candidate;
    }
  }

  // Anti-orphan: if segment ends with a lone preposition, pull it to next segment
  let breakIdx = bestCandidate.index;
  if (
    breakIdx > startIdx &&
    isPrepositionOrConjunction(words[breakIdx].word) &&
    !endsWithClauseBreak(words[breakIdx].word) &&
    !endsSentence(words[breakIdx].word) &&
    (breakIdx - 1 - startIdx + 1) >= MIN_WORDS_PER_SEGMENT
  ) {
    breakIdx = breakIdx - 1;
  }

  return breakIdx;
}

// Find the latest word index reachable from startIdx whose end-time keeps the
// segment duration <= maxDuration. Returns -1 if even the first word exceeds it.
function findMaxIndexWithinDuration(
  words: WordTiming[],
  startIdx: number,
  maxDuration: number
): number {
  const startTime = words[startIdx].start;
  let lastFit = -1;
  for (let i = startIdx; i < words.length; i++) {
    if (words[i].end - startTime <= maxDuration) {
      lastFit = i;
    } else {
      break;
    }
  }
  return lastFit;
}


// Process words into caption segments with semantic break rules
function processWordsIntoSegments(
  words: WordTiming[],
  maxLength: number
): CaptionSegment[] {
  if (words.length === 0) return [];

  const segments: CaptionSegment[] = [];
  let currentStart = 0;

  while (currentStart < words.length) {
    // Check for a silence-gap break first (hard rule, > SILENCE_GAP_THRESHOLD).
    let earlyGapEnd = -1;
    for (let i = currentStart; i < words.length - 1; i++) {
      if (words[i + 1].start - words[i].end > SILENCE_GAP_THRESHOLD) {
        earlyGapEnd = i;
        break;
      }
    }

    // Duration cap: don't let a single caption exceed MAX_SEGMENT_DURATION.
    const maxDurIdx = findMaxIndexWithinDuration(words, currentStart, MAX_SEGMENT_DURATION);

    // Quick check: can all remaining words fit (length, gap, AND duration)?
    const remainingLength = wordsTextLength(words, currentStart, words.length - 1);
    if (
      remainingLength <= maxLength &&
      earlyGapEnd === -1 &&
      maxDurIdx === words.length - 1
    ) {
      const segmentWords = words.slice(currentStart);
      segments.push({
        text: segmentWords.map(w => w.word).join(' '),
        start: segmentWords[0].start,
        end: segmentWords[segmentWords.length - 1].end,
      });
      break;
    }

    // HARD RULE: force a segment break on any silence gap > threshold between words.
    const forcedGapEnd = earlyGapEnd;

    // Scan for the FIRST sentence-ending punctuation within maxLength
    let firstSentenceEnd = -1;
    let scanLength = 0;
    for (let i = currentStart; i < words.length; i++) {
      const addLen = (i === currentStart ? 0 : 1) + words[i].word.length;
      if (scanLength + addLen > maxLength) break;
      scanLength += addLen;

      if (endsSentence(words[i].word) && (i - currentStart + 1) >= MIN_WORDS_PER_SEGMENT) {
        firstSentenceEnd = i;
        break; // Take the first sentence end — one sentence per caption
      }
    }

    let segmentEnd: number;

    if (forcedGapEnd >= 0 && (firstSentenceEnd < 0 || forcedGapEnd <= firstSentenceEnd)) {
      // Hard silence-gap break wins over everything else.
      segmentEnd = forcedGapEnd;
    } else if (firstSentenceEnd >= 0) {
      segmentEnd = firstSentenceEnd;
    } else {
      // No sentence-ending punctuation within limit — use semantic break finding
      segmentEnd = findBestBreakPoint(words, currentStart, maxLength);
    }

    if (segmentEnd < currentStart) segmentEnd = currentStart;

    // Duration cap (3–5s target): if chosen end exceeds 5s, force an earlier
    // natural break inside the duration window.
    if (maxDurIdx >= currentStart && segmentEnd > maxDurIdx) {
      // Search for the latest sentence-end inside the window
      let sentenceIdx = -1;
      let clauseIdx = -1;
      let conjunctionIdx = -1;
      for (let i = currentStart; i <= maxDurIdx; i++) {
        if ((i - currentStart + 1) < MIN_WORDS_PER_SEGMENT) continue;
        const w = words[i].word;
        if (endsSentence(w)) sentenceIdx = i;
        else if (endsWithClauseBreak(w)) clauseIdx = i;
        else if (
          i + 1 < words.length &&
          BREAK_BEFORE_WORDS.has(words[i + 1].word.toLowerCase().replace(/[.,!?;:]+$/, '')) &&
          !isNoBreakAfter(w)
        ) {
          conjunctionIdx = i;
        }
      }
      // Latest safe word-boundary inside the window (grammar-aware fallback)
      let safeWordIdx = -1;
      for (let i = currentStart; i <= maxDurIdx; i++) {
        if ((i - currentStart + 1) >= MIN_WORDS_PER_SEGMENT && !isNoBreakAfter(words[i].word)) {
          safeWordIdx = i;
        }
      }

      if (sentenceIdx >= 0) segmentEnd = sentenceIdx;
      else if (clauseIdx >= 0) segmentEnd = clauseIdx;
      else if (conjunctionIdx >= 0) segmentEnd = conjunctionIdx;
      else if (safeWordIdx >= 0) segmentEnd = safeWordIdx;
      else segmentEnd = maxDurIdx;
    }

    const segmentWords = words.slice(currentStart, segmentEnd + 1);
    segments.push({
      text: segmentWords.map(w => w.word).join(' '),
      start: segmentWords[0].start,
      end: segmentWords[segmentWords.length - 1].end,
    });

    currentStart = segmentEnd + 1;
  }

  return segments;
}

// Merge segments shorter than MIN_SEGMENT_DURATION into a neighbour, as long
// as: (a) the merge doesn't cross a silence gap > SILENCE_GAP_THRESHOLD, and
// (b) the resulting segment stays within MAX_SEGMENT_DURATION. The final
// caption is allowed to remain short.
function mergeShortSegments(segments: CaptionSegment[]): CaptionSegment[] {
  if (segments.length <= 1) return segments;
  const result: CaptionSegment[] = segments.map(s => ({ ...s }));

  let i = 0;
  while (i < result.length) {
    const seg = result[i];
    const duration = seg.end - seg.start;
    const isLast = i === result.length - 1;

    if (duration >= MIN_SEGMENT_DURATION || isLast) {
      i++;
      continue;
    }

    // Try merging with NEXT first (preferred)
    const next = result[i + 1];
    const gapToNext = next.start - seg.end;
    const combinedDurNext = next.end - seg.start;
    if (gapToNext <= SILENCE_GAP_THRESHOLD && combinedDurNext <= MAX_SEGMENT_DURATION) {
      result.splice(i, 2, {
        text: seg.text + ' ' + next.text,
        start: seg.start,
        end: next.end,
      });
      continue; // re-check the merged segment
    }

    // Else try PREVIOUS
    if (i > 0) {
      const prev = result[i - 1];
      const gapFromPrev = seg.start - prev.end;
      const combinedDurPrev = seg.end - prev.start;
      if (gapFromPrev <= SILENCE_GAP_THRESHOLD && combinedDurPrev <= MAX_SEGMENT_DURATION) {
        result.splice(i - 1, 2, {
          text: prev.text + ' ' + seg.text,
          start: prev.start,
          end: seg.end,
        });
        i = Math.max(0, i - 1);
        continue;
      }
    }

    // Cannot safely merge — leave as is.
    i++;
  }

  return result;
}


// Apply anti-orphan logic (3-word rule)
function applyAntiOrphanLogic(segments: CaptionSegment[]): CaptionSegment[] {
  if (segments.length <= 1) return segments;

  const result: CaptionSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const wordCount = segment.text.split(/\s+/).filter(w => w.length > 0).length;

    if (wordCount < MIN_WORDS_PER_SEGMENT) {
      // Exception: standalone interjections should not be merged
      if (isStandaloneInterjection(segment.text)) {
        result.push(segment);
        continue;
      }

      // Try to merge with preceding segment (unless it ends with a period)
      if (result.length > 0) {
        const prevSegment = result[result.length - 1];
        const prevEndsWithPeriod = /\.\s*$/.test(prevSegment.text);

        if (!prevEndsWithPeriod) {
          result[result.length - 1] = {
            text: prevSegment.text + ' ' + segment.text,
            start: prevSegment.start,
            end: segment.end,
          };
          continue;
        }
      }

      // Fallback: merge with following segment
      if (i < segments.length - 1) {
        const nextSegment = segments[i + 1];
        segments[i + 1] = {
          text: segment.text + ' ' + nextSegment.text,
          start: segment.start,
          end: nextSegment.end,
        };
        continue;
      }

      result.push(segment);
    } else {
      result.push(segment);
    }
  }

  return result;
}

// Main function: Process all words from all segments into properly timed captions
function buildCaptionSegments(
  segments: TranscriptSegment[],
  maxLength: number
): CaptionSegment[] {
  const allWords: WordTiming[] = [];

  for (const segment of segments) {
    if (segment.words && segment.words.length > 0) {
      allWords.push(...segment.words);
    } else {
      const estimated = estimateWordTimings(segment.text, segment.startTime, segment.endTime);
      allWords.push(...estimated);
    }
  }

  if (allWords.length === 0) return [];

  const rawSegments = processWordsIntoSegments(allWords, maxLength);
  const orphanFixed = applyAntiOrphanLogic(rawSegments);
  const finalSegments = mergeShortSegments(orphanFixed);

  return finalSegments;
}


// Convert CaptionSegment array to TranscriptSegment array
function captionsToTranscriptSegments(captions: CaptionSegment[]): TranscriptSegment[] {
  return captions.map(cap => ({
    startTime: cap.start,
    endTime: cap.end,
    text: cap.text,
  }));
}

// Clamp segments to audio duration
function clampSegmentsToDuration(segments: TranscriptSegment[], maxDuration: number): TranscriptSegment[] {
  return segments
    .filter(segment => segment.startTime < maxDuration)
    .map(segment => ({
      ...segment,
      startTime: Math.min(segment.startTime, maxDuration),
      endTime: Math.min(segment.endTime, maxDuration),
    }))
    .filter(segment => segment.endTime > segment.startTime);
}

// Generate SRT content
export function generateSRT(segments: TranscriptSegment[], audioDuration?: number, maxLineLength: number = DEFAULT_MAX_LINE_LENGTH): string {
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
  
  const captionSegments = buildCaptionSegments(segments, maxLineLength);
  let processedSegments = captionsToTranscriptSegments(captionSegments);
  
  if (audioDuration !== undefined && audioDuration > 0) {
    processedSegments = clampSegmentsToDuration(processedSegments, audioDuration);
  }
  
  const lines: string[] = [];
  
  processedSegments.forEach((segment, index) => {
    lines.push(String(index + 1));
    lines.push(`${formatTime(segment.startTime)} --> ${formatTime(segment.endTime)}`);
    lines.push(segment.text);
    lines.push('');
  });
  
  return lines.join('\n');
}

export function downloadSRT(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/\.[^/.]+$/, '') + '.srt';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.addEventListener('loadedmetadata', () => {
      resolve(audio.duration);
      URL.revokeObjectURL(audio.src);
    });
    audio.addEventListener('error', reject);
    audio.src = URL.createObjectURL(file);
  });
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
