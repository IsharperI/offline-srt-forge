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
const MIN_WORDS_PER_CAPTION = 3;
const MIN_WORDS_ABSOLUTE = 2; // Caption must always have more than 1 word

// Group words into natural segments (sentences/phrases) while preserving word timings
function groupWordsIntoSegments(words: WordTiming[]): TranscriptSegment[] {
  if (words.length === 0) return [];
  
  const segments: TranscriptSegment[] = [];
  let currentWords: WordTiming[] = [];
  
  for (const word of words) {
    currentWords.push(word);
    
    // Check if this word ends a sentence
    if (/[.!?]$/.test(word.word)) {
      segments.push({
        startTime: currentWords[0].start,
        endTime: currentWords[currentWords.length - 1].end,
        text: currentWords.map(w => w.word).join(' '),
        words: [...currentWords],
      });
      currentWords = [];
    }
  }
  
  // Push remaining words as final segment
  if (currentWords.length > 0) {
    segments.push({
      startTime: currentWords[0].start,
      endTime: currentWords[currentWords.length - 1].end,
      text: currentWords.map(w => w.word).join(' '),
      words: [...currentWords],
    });
  }
  
  return segments;
}

// Split text by sentences (. ! ?) while preserving the delimiters
function splitBySentences(text: string): string[] {
  // Match sentences ending with . ! ? followed by space or end of string
  const sentenceRegex = /[^.!?]*[.!?]+(?:\s+|$)|[^.!?]+$/g;
  const matches = text.match(sentenceRegex);
  
  if (!matches) return [text.trim()];
  
  return matches
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// Split text by commas
function splitByCommas(text: string): string[] {
  const parts = text.split(',').map(s => s.trim()).filter(s => s.length > 0);
  
  // Preserve commas except for the last part
  return parts.map((part, i) => i < parts.length - 1 ? part + ',' : part);
}

// Split by word count respecting max length and minimum word requirements
function splitByMaxLength(text: string, maxLength: number): string[] {
  const words = text.split(' ').filter(w => w.length > 0);
  
  // If total words <= MIN_WORDS_PER_CAPTION, return as single chunk regardless of length
  if (words.length <= MIN_WORDS_PER_CAPTION) {
    return [text];
  }
  
  // If text fits within max length, return as-is
  if (text.length <= maxLength) {
    return [text];
  }
  
  const chunks: string[] = [];
  let currentWords: string[] = [];
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testChunk = [...currentWords, word].join(' ');
    const remainingWords = words.length - i - 1;
    
    // Check if adding this word exceeds max length
    if (testChunk.length > maxLength && currentWords.length >= MIN_WORDS_PER_CAPTION) {
      // We have enough words and exceeded limit - save current chunk
      chunks.push(currentWords.join(' '));
      currentWords = [word];
    } else if (testChunk.length > maxLength && currentWords.length < MIN_WORDS_PER_CAPTION) {
      // Exceeded limit but don't have minimum words yet - keep adding
      currentWords.push(word);
      
      // If we now have minimum words and remaining words can form valid chunks, split here
      if (currentWords.length >= MIN_WORDS_PER_CAPTION && remainingWords >= MIN_WORDS_PER_CAPTION) {
        chunks.push(currentWords.join(' '));
        currentWords = [];
      }
    } else {
      // Still within limit, add the word
      currentWords.push(word);
    }
  }
  
  // Handle remaining words
  if (currentWords.length > 0) {
    if (currentWords.length < MIN_WORDS_PER_CAPTION && chunks.length > 0) {
      // Merge with previous chunk to ensure minimum words
      const lastChunk = chunks.pop()!;
      chunks.push(lastChunk + ' ' + currentWords.join(' '));
    } else {
      chunks.push(currentWords.join(' '));
    }
  }
  
  return chunks;
}

// Ensure each chunk has more than 1 word by merging if necessary
function ensureMinWords(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;
  
  const result: string[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const wordCount = chunk.split(' ').filter(w => w.length > 0).length;
    
    if (wordCount < MIN_WORDS_ABSOLUTE) {
      // Merge with previous or next chunk
      if (result.length > 0) {
        result[result.length - 1] = result[result.length - 1] + ' ' + chunk;
      } else if (i < chunks.length - 1) {
        chunks[i + 1] = chunk + ' ' + chunks[i + 1];
      } else {
        result.push(chunk);
      }
    } else {
      result.push(chunk);
    }
  }
  
  return result;
}

// Split text into chunks with priority:
// 1. Sentences first
// 2. If sentence > maxLength, split by commas
// 3. If still > maxLength or no commas, split by maxLength (min 3 words per chunk)
// 4. Always ensure more than 1 word per caption
function splitTextIntoChunks(text: string, maxLength: number): string[] {
  // Step 1: Split by sentences
  const sentences = splitBySentences(text);
  
  const allChunks: string[] = [];
  
  for (const sentence of sentences) {
    // If sentence fits, keep it as-is
    if (sentence.length <= maxLength) {
      allChunks.push(sentence);
      continue;
    }
    
    // Step 2: Try splitting by commas
    const commaParts = splitByCommas(sentence);
    
    if (commaParts.length > 1) {
      // Process each comma-separated part
      for (const part of commaParts) {
        if (part.length <= maxLength) {
          allChunks.push(part);
        } else {
          // Step 3: Split by max length with min word requirements
          const lengthChunks = splitByMaxLength(part, maxLength);
          allChunks.push(...lengthChunks);
        }
      }
    } else {
      // No commas - Step 3: Split by max length with min word requirements
      const lengthChunks = splitByMaxLength(sentence, maxLength);
      allChunks.push(...lengthChunks);
    }
  }
  
  // Step 4: Ensure all chunks have more than 1 word
  return ensureMinWords(allChunks);
}

// Split segments that exceed max characters using word-level timestamps
function splitLongSegments(segments: TranscriptSegment[], maxLineLength: number): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];
  
  for (const segment of segments) {
    const chunks = splitTextIntoChunks(segment.text, maxLineLength);
    
    if (chunks.length === 1) {
      result.push(segment);
    } else if (segment.words && segment.words.length > 0) {
      // Use word-level timing for accurate splits
      const wordTimedChunks = splitWithWordTiming(segment.words, chunks);
      result.push(...wordTimedChunks);
    } else {
      // Fallback: proportional timing if no word-level data
      const totalDuration = segment.endTime - segment.startTime;
      const durationPerChunk = totalDuration / chunks.length;
      
      chunks.forEach((chunk, i) => {
        result.push({
          startTime: segment.startTime + (i * durationPerChunk),
          endTime: segment.startTime + ((i + 1) * durationPerChunk),
          text: chunk
        });
      });
    }
  }
  
  return result;
}

// Split using word-level timing - each chunk gets timing from its first/last word
function splitWithWordTiming(words: WordTiming[], chunks: string[]): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];
  let wordIndex = 0;
  
  for (const chunk of chunks) {
    const chunkWords = chunk.split(/\s+/).filter(w => w.length > 0);
    const chunkWordCount = chunkWords.length;
    
    if (chunkWordCount === 0) continue;
    
    // Find matching words in the word timing array
    const startWordIndex = wordIndex;
    const endWordIndex = Math.min(wordIndex + chunkWordCount - 1, words.length - 1);
    
    // Ensure we don't go out of bounds
    if (startWordIndex >= words.length) {
      // Fallback: use last word's timing
      const lastWord = words[words.length - 1];
      result.push({
        startTime: lastWord.start,
        endTime: lastWord.end,
        text: chunk,
      });
    } else {
      result.push({
        startTime: words[startWordIndex].start,
        endTime: words[endWordIndex].end,
        text: chunk,
      });
    }
    
    wordIndex += chunkWordCount;
  }
  
  return result;
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
  
  // Apply character line limit splitting
  let processedSegments = splitLongSegments(segments, maxLineLength);
  
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
