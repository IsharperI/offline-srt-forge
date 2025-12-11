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
    transcriber = await pipeline(
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
    onProgress?.({ status: 'loading', progress: 100, message: 'Model loaded successfully' });
  } catch (error) {
    console.error('Failed to load transcriber:', error);
    throw error;
  } finally {
    isLoading = false;
  }
}

export async function transcribeAudio(
  audioFile: File,
  onProgress?: (progress: TranscriptionProgress) => void
): Promise<TranscriptSegment[]> {
  if (!transcriber) {
    await initializeTranscriber(onProgress);
  }
  
  onProgress?.({ status: 'transcribing', progress: 0, message: 'Processing audio...' });
  
  // Convert file to audio URL
  const audioUrl = URL.createObjectURL(audioFile);
  
  try {
    const result = await transcriber!(audioUrl, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    }) as AutomaticSpeechRecognitionOutput;
    
    onProgress?.({ status: 'processing', progress: 80, message: 'Processing transcription...' });
    
    // Convert to our segment format
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
      // Fallback: if no chunks, create a single segment
      segments.push({
        startTime: 0,
        endTime: 30, // Approximate
        text: result.text.trim()
      });
    }
    
    onProgress?.({ status: 'complete', progress: 100, message: 'Transcription complete' });
    
    return segments;
  } finally {
    URL.revokeObjectURL(audioUrl);
  }
}

// Step B: Sanitization Layer
export function sanitizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const silencePatterns = [
    /^\s*\[silence\]\s*$/i,
    /^\s*\(silence\)\s*$/i,
    /^\s*\[blank_audio\]\s*$/i,
    /^\s*\(blank_audio\)\s*$/i,
    /^\s*\[blank audio\]\s*$/i,
    /^\s*\(blank audio\)\s*$/i,
  ];
  
  const isSilenceOnly = (text: string): boolean => {
    return silencePatterns.some(pattern => pattern.test(text));
  };
  
  const cleanMixedContent = (text: string): string => {
    let cleaned = text;
    cleaned = cleaned.replace(/\[silence\]/gi, '').trim();
    cleaned = cleaned.replace(/\(silence\)/gi, '').trim();
    cleaned = cleaned.replace(/\[blank_audio\]/gi, '').trim();
    cleaned = cleaned.replace(/\(blank_audio\)/gi, '').trim();
    cleaned = cleaned.replace(/\[blank audio\]/gi, '').trim();
    cleaned = cleaned.replace(/\(blank audio\)/gi, '').trim();
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

// Generate SRT content
export function generateSRT(segments: TranscriptSegment[]): string {
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.round((seconds % 1) * 1000);
    
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
  };
  
  const lines: string[] = [];
  
  segments.forEach((segment, index) => {
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
