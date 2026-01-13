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
let isLoading = false;
let currentModelId: string | null = null;

const DEFAULT_MODEL = 'onnx-community/whisper-tiny.en';

export async function initializeTranscriber(
  onProgress?: (progress: TranscriptionProgress) => void,
  modelId: string = DEFAULT_MODEL
): Promise<void> {
  // If we already have a transcriber for this model, skip
  if (transcriber && currentModelId === modelId) return;
  
  // If loading is in progress, wait
  if (isLoading) return;
  
  // If switching models, reset the transcriber
  if (currentModelId !== modelId) {
    transcriber = null;
    currentModelId = null;
  }
  
  isLoading = true;
  onProgress?.({ status: 'loading', progress: 0, message: `Loading model: ${modelId}...` });
  
  try {
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
    
    // Validate that we got a callable function
    if (typeof result !== 'function') {
      console.error('Pipeline returned non-function:', typeof result, result);
      throw new Error('Model failed to initialize properly');
    }
    
    transcriber = result;
    currentModelId = modelId;
    console.log('Transcriber initialized successfully:', typeof transcriber, 'Model:', modelId);
    onProgress?.({ status: 'loading', progress: 100, message: 'Model loaded successfully' });
  } catch (error) {
    console.error('Failed to load transcriber:', error);
    throw error;
  } finally {
    isLoading = false;
  }
}

export function getCurrentModelId(): string | null {
  return currentModelId;
}

export function resetTranscriber(): void {
  transcriber = null;
  currentModelId = null;
}

// Estimate word-level timings by distributing duration proportionally across words
function estimateWordTimings(text: string, startTime: number, endTime: number): WordTiming[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];
  
  const totalDuration = endTime - startTime;
  
  // Calculate total character count for proportional distribution
  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  
  const result: WordTiming[] = [];
  let currentTime = startTime;
  
  for (const word of words) {
    // Duration proportional to word length
    const wordDuration = (word.length / totalChars) * totalDuration;
    const wordEnd = currentTime + wordDuration;
    
    result.push({
      word,
      start: currentTime,
      end: wordEnd,
    });
    
    currentTime = wordEnd;
  }
  
  return result;
}

// Add inaudible noise to prevent silence detection
// Noise amplitude is ~0.001 (-60dB), imperceptible to human ears
async function addInaudibleNoise(audioBuffer: ArrayBuffer): Promise<Blob> {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  try {
    const decodedAudio = await audioContext.decodeAudioData(audioBuffer.slice(0));
    const numberOfChannels = decodedAudio.numberOfChannels;
    const sampleRate = decodedAudio.sampleRate;
    const length = decodedAudio.length;
    
    // Create offline context for processing
    const offlineContext = new OfflineAudioContext(numberOfChannels, length, sampleRate);
    
    // Copy and add noise to each channel
    const outputBuffer = offlineContext.createBuffer(numberOfChannels, length, sampleRate);
    
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const inputData = decodedAudio.getChannelData(channel);
      const outputData = outputBuffer.getChannelData(channel);
      
      for (let i = 0; i < length; i++) {
        // Add very low amplitude noise (-60dB, ~0.001 amplitude)
        const noise = (Math.random() * 2 - 1) * 0.001;
        outputData[i] = inputData[i] + noise;
      }
    }
    
    // Encode to WAV
    return encodeWAV(outputBuffer);
  } finally {
    await audioContext.close();
  }
}

// Encode AudioBuffer to WAV Blob
function encodeWAV(audioBuffer: AudioBuffer): Blob {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  
  // Interleave channels
  const interleaved = new Float32Array(length * numberOfChannels);
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      interleaved[i * numberOfChannels + channel] = channelData[i];
    }
  }
  
  // Convert to 16-bit PCM
  const buffer = new ArrayBuffer(44 + interleaved.length * 2);
  const view = new DataView(buffer);
  
  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + interleaved.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (PCM)
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numberOfChannels * 2, true); // ByteRate
  view.setUint16(32, numberOfChannels * 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, 'data');
  view.setUint32(40, interleaved.length * 2, true);
  
  // Write samples
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
  modelId?: string
): Promise<TranscriptSegment[]> {
  const targetModel = modelId || 'onnx-community/whisper-tiny.en';
  
  // Ensure transcriber is initialized and valid for the correct model
  if (!transcriber || typeof transcriber !== 'function' || currentModelId !== targetModel) {
    transcriber = null; // Reset if invalid or different model
    await initializeTranscriber(onProgress, targetModel);
  }
  
  if (typeof transcriber !== 'function') {
    throw new Error('Failed to initialize transcription model');
  }
  
  onProgress?.({ status: 'transcribing', progress: 0, message: 'Processing audio...' });
  
  // Convert file to ArrayBuffer
  const arrayBuffer = await audioFile.arrayBuffer();
  
  if (arrayBuffer.byteLength === 0) {
    throw new Error('Audio file is empty');
  }
  
  console.log(`Processing file: ${audioFile.name}, size: ${arrayBuffer.byteLength} bytes, type: ${audioFile.type}`);
  
  onProgress?.({ status: 'transcribing', progress: 5, message: 'Adding noise floor...' });
  
  // Add inaudible noise to prevent silence detection
  let processedBlob: Blob;
  try {
    processedBlob = await addInaudibleNoise(arrayBuffer);
    console.log('Added inaudible noise floor to audio');
  } catch (noiseError) {
    console.warn('Could not add noise, using original audio:', noiseError);
    processedBlob = new Blob([arrayBuffer], { type: audioFile.type || 'audio/wav' });
  }
  
  const audioUrl = URL.createObjectURL(processedBlob);
  
  try {
    onProgress?.({ status: 'transcribing', progress: 10, message: 'Transcribing audio...' });
    
    // Use chunk-level timestamps (word-level not supported by all ONNX models)
    const result = await transcriber!(audioUrl, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    }) as AutomaticSpeechRecognitionOutput;
    
    console.log('Transcription result:', result);
    
    onProgress?.({ status: 'processing', progress: 80, message: 'Processing transcription...' });
    
    const segments: TranscriptSegment[] = [];
    
    if (result.chunks && Array.isArray(result.chunks)) {
      for (const chunk of result.chunks) {
        if (chunk.timestamp && Array.isArray(chunk.timestamp)) {
          const [start, end] = chunk.timestamp;
          const text = chunk.text?.trim() || '';
          if (text) {
            const startTime = typeof start === 'number' ? start : 0;
            const endTime = typeof end === 'number' ? end : (startTime + 2);
            
            // Generate word-level timing estimates from chunk
            const words = estimateWordTimings(text, startTime, endTime);
            
            segments.push({
              startTime,
              endTime,
              text,
              words,
            });
          }
        }
      }
    } else if (result.text) {
      // Fallback: no timestamps available
      const words = estimateWordTimings(result.text.trim(), 0, 30);
      segments.push({
        startTime: 0,
        endTime: 30,
        text: result.text.trim(),
        words,
      });
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
  // Comprehensive silence patterns - catches all known variants
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
    /^\s*\.\s*$/,  // Just a period
    /^\s*$/,  // Empty or whitespace only
  ];
  
  // Patterns to clean from mixed content
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
    for (const pattern of cleanPatterns) {
      cleaned = cleaned.replace(pattern, '').trim();
    }
    // Clean up multiple spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
  };
  
  const result: TranscriptSegment[] = [];
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    // Check if this is a silence-only segment
    if (isSilenceOnly(segment.text)) {
      // If there's a previous segment and a next non-silence segment
      // Extend the previous segment's endTime
      if (result.length > 0) {
        // Find next non-silence segment
        let nextNonSilenceIndex = -1;
        for (let j = i + 1; j < segments.length; j++) {
          if (!isSilenceOnly(segments[j].text)) {
            nextNonSilenceIndex = j;
            break;
          }
        }
        
        if (nextNonSilenceIndex !== -1) {
          // Extend previous segment to the start of next non-silence segment
          result[result.length - 1].endTime = segments[nextNonSilenceIndex].startTime;
        }
      }
      // Skip this silence segment
      continue;
    }
    
    // Clean mixed content
    const cleanedText = cleanMixedContent(segment.text);
    
    // Skip if cleaning resulted in empty text
    if (!cleanedText) {
      continue;
    }
    
    result.push({
      startTime: segment.startTime,
      endTime: segment.endTime,
      text: cleanedText
    });
  }
  
  return result;
}

// Step C: Re-indexing (handled during SRT generation)

const DEFAULT_MAX_LINE_LENGTH = 80;
const MIN_WORDS_PER_SEGMENT = 3;

// Conjunctions and prepositions to break BEFORE
const BREAK_BEFORE_WORDS = new Set([
  'and', 'but', 'so', 'because', 'or', 'yet', 'nor',
  'for', 'in', 'on', 'at', 'to', 'with', 'from', 'by',
  'of', 'about', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'between', 'under', 'over',
  'while', 'although', 'though', 'unless', 'until', 'when',
  'where', 'if', 'then', 'than', 'as', 'since', 'that', 'which'
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

// Check if a word ends with a comma
function endsWithComma(word: string): boolean {
  return /,$/.test(word);
}

// Check if text is a standalone interjection
function isStandaloneInterjection(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return STANDALONE_INTERJECTIONS.has(normalized);
}

// Find the best break point within a word range
function findBestBreakPoint(
  words: WordTiming[],
  startIdx: number,
  endIdx: number,
  maxLength: number
): number {
  let currentLength = 0;
  let lastGoodBreak = startIdx;
  let lastPunctuationBreak = -1;
  let lastCommaBreak = -1;
  let lastConjunctionBreak = -1;

  for (let i = startIdx; i <= endIdx; i++) {
    const word = words[i].word;
    const addLength = (i === startIdx ? 0 : 1) + word.length; // +1 for space

    // Check if adding this word exceeds max length
    if (currentLength + addLength > maxLength && i > startIdx) {
      // Return the best break point found
      if (lastPunctuationBreak >= startIdx + MIN_WORDS_PER_SEGMENT - 1) {
        return lastPunctuationBreak + 1;
      }
      if (lastCommaBreak >= startIdx + MIN_WORDS_PER_SEGMENT - 1) {
        return lastCommaBreak + 1;
      }
      if (lastConjunctionBreak >= startIdx + MIN_WORDS_PER_SEGMENT - 1) {
        return lastConjunctionBreak;
      }
      // Fallback: break at current position if we have minimum words
      if (i - startIdx >= MIN_WORDS_PER_SEGMENT) {
        return i;
      }
      // Keep going to ensure minimum words
      lastGoodBreak = i;
    }

    currentLength += addLength;

    // Track potential break points
    if (endsSentence(word)) {
      lastPunctuationBreak = i;
    }
    if (endsWithComma(word)) {
      lastCommaBreak = i;
    }
    // Check if NEXT word is a conjunction/preposition
    if (i < endIdx && BREAK_BEFORE_WORDS.has(words[i + 1].word.toLowerCase().replace(/[.,!?]$/, ''))) {
      lastConjunctionBreak = i + 1;
    }
  }

  return endIdx + 1;
}

// Process words into caption segments with proper timing
function processWordsIntoSegments(
  words: WordTiming[],
  maxLength: number
): CaptionSegment[] {
  if (words.length === 0) return [];

  const segments: CaptionSegment[] = [];
  let currentStart = 0;

  while (currentStart < words.length) {
    // Build text from current position to find where we need to break
    let currentText = '';
    let sentenceEndIdx = -1;
    let potentialEnd = words.length - 1;

    // First, try to find a sentence end within limits
    for (let i = currentStart; i < words.length; i++) {
      const word = words[i].word;
      const testText = currentText + (currentText ? ' ' : '') + word;

      if (endsSentence(word)) {
        if (testText.length <= maxLength) {
          sentenceEndIdx = i;
        } else if (sentenceEndIdx === -1) {
          // Sentence is too long, need to break before end
          break;
        }
      }

      if (testText.length > maxLength && i > currentStart) {
        potentialEnd = i - 1;
        break;
      }

      currentText = testText;
      potentialEnd = i;
    }

    // Determine the actual end of this segment
    let segmentEnd: number;

    if (sentenceEndIdx >= currentStart && words.slice(currentStart, sentenceEndIdx + 1).map(w => w.word).join(' ').length <= maxLength) {
      // Complete sentence fits
      segmentEnd = sentenceEndIdx;
    } else {
      // Need to find best break point
      segmentEnd = findBestBreakPoint(words, currentStart, potentialEnd, maxLength) - 1;
      if (segmentEnd < currentStart) segmentEnd = currentStart;
    }

    // Ensure we have at least one word
    if (segmentEnd < currentStart) {
      segmentEnd = currentStart;
    }

    // Create segment
    const segmentWords = words.slice(currentStart, segmentEnd + 1);
    const text = segmentWords.map(w => w.word).join(' ');

    segments.push({
      text,
      start: segmentWords[0].start,
      end: segmentWords[segmentWords.length - 1].end,
    });

    currentStart = segmentEnd + 1;
  }

  return segments;
}

// Apply anti-orphan logic (3-word rule)
function applyAntiOrphanLogic(segments: CaptionSegment[]): CaptionSegment[] {
  if (segments.length <= 1) return segments;

  const result: CaptionSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const wordCount = segment.text.split(/\s+/).filter(w => w.length > 0).length;

    // Check if this segment has fewer than 3 words
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
          // Merge with previous
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

      // No merge possible, keep as-is
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
  // First, collect all words from all segments
  const allWords: WordTiming[] = [];

  for (const segment of segments) {
    if (segment.words && segment.words.length > 0) {
      allWords.push(...segment.words);
    } else {
      // Estimate word timings if not available
      const estimated = estimateWordTimings(segment.text, segment.startTime, segment.endTime);
      allWords.push(...estimated);
    }
  }

  if (allWords.length === 0) return [];

  // Process words into segments respecting rules
  const rawSegments = processWordsIntoSegments(allWords, maxLength);

  // Apply anti-orphan logic
  const finalSegments = applyAntiOrphanLogic(rawSegments);

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
    .filter(segment => segment.startTime < maxDuration) // Remove segments that start after audio ends
    .map(segment => ({
      ...segment,
      startTime: Math.min(segment.startTime, maxDuration),
      endTime: Math.min(segment.endTime, maxDuration),
    }))
    .filter(segment => segment.endTime > segment.startTime); // Remove zero-duration segments
}

// Generate SRT content
export function generateSRT(segments: TranscriptSegment[], audioDuration?: number, maxLineLength: number = DEFAULT_MAX_LINE_LENGTH): string {
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.round((seconds % 1) * 1000);
    
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
  };
  
  // Build caption segments using word-level timing and strict rules
  const captionSegments = buildCaptionSegments(segments, maxLineLength);
  let processedSegments = captionsToTranscriptSegments(captionSegments);
  
  // Clamp to audio duration if provided
  if (audioDuration !== undefined && audioDuration > 0) {
    processedSegments = clampSegmentsToDuration(processedSegments, audioDuration);
  }
  
  const lines: string[] = [];
  
  processedSegments.forEach((segment, index) => {
    // Re-indexed numbering (Step C)
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
