import { pipeline, type AutomaticSpeechRecognitionOutput } from "@huggingface/transformers";

export interface TranscriptSegment {
  startTime: number;
  endTime: number;
  text: string;
}

export interface TranscriptionProgress {
  status: 'loading' | 'transcribing' | 'processing' | 'complete' | 'error';
  progress: number;
  message: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;
let isLoading = false;

export async function initializeTranscriber(
  onProgress?: (progress: TranscriptionProgress) => void
): Promise<void> {
  if (transcriber || isLoading) return;
  
  isLoading = true;
  onProgress?.({ status: 'loading', progress: 0, message: 'Loading speech recognition model...' });
  
  try {
    const result = await pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-tiny.en",
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
    console.log('Transcriber initialized successfully:', typeof transcriber);
    onProgress?.({ status: 'loading', progress: 100, message: 'Model loaded successfully' });
  } catch (error) {
    console.error('Failed to load transcriber:', error);
    throw error;
  } finally {
    isLoading = false;
  }
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
  onProgress?: (progress: TranscriptionProgress) => void
): Promise<TranscriptSegment[]> {
  // Ensure transcriber is initialized and valid
  if (!transcriber || typeof transcriber !== 'function') {
    transcriber = null; // Reset if invalid
    await initializeTranscriber(onProgress);
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
          segments.push({
            startTime: typeof start === 'number' ? start : 0,
            endTime: typeof end === 'number' ? end : (typeof start === 'number' ? start + 2 : 2),
            text: chunk.text?.trim() || ''
          });
        }
      }
    } else if (result.text) {
      segments.push({
        startTime: 0,
        endTime: 30,
        text: result.text.trim()
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

// Split text into chunks respecting word boundaries and max length
function splitTextIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }
  
  const words = text.split(' ');
  const chunks: string[] = [];
  let currentChunk = '';
  
  for (const word of words) {
    const testChunk = currentChunk ? `${currentChunk} ${word}` : word;
    
    if (testChunk.length <= maxLength) {
      currentChunk = testChunk;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      // Handle words longer than maxLength
      if (word.length > maxLength) {
        let remaining = word;
        while (remaining.length > maxLength) {
          chunks.push(remaining.slice(0, maxLength));
          remaining = remaining.slice(maxLength);
        }
        currentChunk = remaining;
      } else {
        currentChunk = word;
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

// Split segments that exceed max characters with proportional timestamps
function splitLongSegments(segments: TranscriptSegment[], maxLineLength: number): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];
  
  for (const segment of segments) {
    const chunks = splitTextIntoChunks(segment.text, maxLineLength);
    
    if (chunks.length === 1) {
      result.push(segment);
    } else {
      // Split timestamp proportionally across chunks
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
