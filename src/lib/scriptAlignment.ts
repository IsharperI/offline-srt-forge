import { TranscriptSegment, WordTiming } from './transcription';

export interface AlignmentResult {
  segments: TranscriptSegment[];
  matchPercentage: number;
}

// ==========================================
// DOCX Text Extraction (browser-native)
// ==========================================

export async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const blob = new Blob([arrayBuffer]);
  
  // .docx is a ZIP file — use DecompressionStream to extract
  const ds = new DecompressionStream('deflate-raw');
  
  // We need to find the document.xml inside the ZIP
  // ZIP format: local file headers + compressed data
  const bytes = new Uint8Array(arrayBuffer);
  
  const entries = parseZipEntries(bytes);
  const docEntry = entries.find(e => e.filename === 'word/document.xml');
  
  if (!docEntry) {
    throw new Error('Could not find word/document.xml in .docx file');
  }
  
  let xmlText: string;
  
  if (docEntry.compressionMethod === 0) {
    // Stored (no compression)
    const decoder = new TextDecoder();
    xmlText = decoder.decode(docEntry.compressedData);
  } else {
    // Deflated — use DecompressionStream
    const compressedStream = new Blob([docEntry.compressedData.buffer as ArrayBuffer]).stream();
    const decompressedStream = compressedStream.pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = decompressedStream.getReader();
    const chunks: Uint8Array[] = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    
    xmlText = new TextDecoder().decode(combined);
  }
  
  // Strip XML tags and extract text content
  // In Word XML, text is inside <w:t> tags, paragraphs are <w:p>
  const text = xmlText
    .replace(/<\/?w:p>/g, '\n') // paragraph breaks
    .replace(/<w:br[^>]*\/>/g, '\n') // line breaks
    .replace(/<w:tab[^>]*\/>/g, ' ') // tabs
    .replace(/<[^>]+>/g, '') // strip all tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '\"')
    .replace(/&apos;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n') // collapse excessive newlines
    .trim();
  
  return text;
}

interface ZipEntry {
  filename: string;
  compressionMethod: number;
  compressedData: Uint8Array;
}

function parseZipEntries(data: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  
  while (offset < data.length - 4) {
    // Local file header signature = 0x04034b50
    if (
      data[offset] === 0x50 &&
      data[offset + 1] === 0x4b &&
      data[offset + 2] === 0x03 &&
      data[offset + 3] === 0x04
    ) {
      const compressionMethod = data[offset + 8] | (data[offset + 9] << 8);
      const compressedSize = 
        data[offset + 18] |
        (data[offset + 19] << 8) |
        (data[offset + 20] << 16) |
        (data[offset + 21] << 24);
      const filenameLength = data[offset + 26] | (data[offset + 27] << 8);
      const extraLength = data[offset + 28] | (data[offset + 29] << 8);
      
      const filenameStart = offset + 30;
      const filename = new TextDecoder().decode(
        data.slice(filenameStart, filenameStart + filenameLength)
      );
      
      const dataStart = filenameStart + filenameLength + extraLength;
      const compressedData = data.slice(dataStart, dataStart + compressedSize);
      
      entries.push({ filename, compressionMethod, compressedData });
      
      offset = dataStart + compressedSize;
    } else {
      break; // No more local file headers
    }
  }
  
  return entries;
}

// ==========================================
// Script Template
// ==========================================

export function generateScriptTemplate(): string {
  return `=== SRT GENERATOR - SCRIPT TEMPLATE ===

FORMAT GUIDELINES:
- Write one sentence per line
- Use blank lines to separate paragraphs or scenes
- Punctuation matters: periods, commas, and question marks
  help the AI break captions at natural points
- Speaker labels (optional): prefix lines with "SPEAKER:"
- Keep the script in the same language as the audio

EXAMPLE:
---
Welcome to our product overview.
Today we'll walk through three key features.

First, let's talk about the dashboard.
The dashboard gives you a real-time view of all your metrics.
You can customize it to show exactly what matters to you.

Next, we have the reporting module.
Reports can be exported as PDF or CSV files.
---

TIPS:
- The closer your script matches the actual spoken words,
  the more accurate the timing alignment will be.
- Minor differences (um, uh, filler words) are handled
  automatically — you don't need to include them.
- If your audio has multiple speakers, labeling them
  helps you keep track but doesn't affect timing.
`;
}

export function downloadScriptTemplate(): void {
  const content = generateScriptTemplate();
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'script-template.txt';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ==========================================
// Alignment Algorithm
// ==========================================

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[.,!?;:'"()[\]{}-–—]+/g, '')
    .trim();
}

interface TimedWord {
  word: string;
  normalized: string;
  start: number;
  end: number;
}

export function alignScriptToAudio(
  scriptText: string,
  transcribedSegments: TranscriptSegment[]
): AlignmentResult {
  // Flatten all transcribed segments into timed words
  const timedWords: TimedWord[] = [];
  
  for (const segment of transcribedSegments) {
    if (segment.words && segment.words.length > 0) {
      for (const w of segment.words) {
        timedWords.push({
          word: w.word,
          normalized: normalizeWord(w.word),
          start: w.start,
          end: w.end,
        });
      }
    } else {
      // Estimate word timings
      const words = segment.text.split(/\s+/).filter(w => w.length > 0);
      const totalDuration = segment.endTime - segment.startTime;
      const totalChars = words.reduce((sum, w) => sum + w.length, 0);
      let currentTime = segment.startTime;
      
      for (const word of words) {
        const wordDuration = totalChars > 0 ? (word.length / totalChars) * totalDuration : totalDuration / words.length;
        const wordEnd = currentTime + wordDuration;
        timedWords.push({
          word,
          normalized: normalizeWord(word),
          start: currentTime,
          end: wordEnd,
        });
        currentTime = wordEnd;
      }
    }
  }
  
  // Parse script into words (preserve original text)
  const scriptWords = scriptText
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => ({ original: w, normalized: normalizeWord(w) }));
  
  if (scriptWords.length === 0 || timedWords.length === 0) {
    return { segments: [], matchPercentage: 0 };
  }
  
  // Sequential greedy matching
  interface AlignedWord {
    word: string; // script's original word
    start: number | null;
    end: number | null;
    matched: boolean;
  }
  
  const aligned: AlignedWord[] = [];
  let transcriptIdx = 0;
  let matchCount = 0;
  
  for (const scriptWord of scriptWords) {
    if (!scriptWord.normalized) {
      // Punctuation-only token, keep it
      aligned.push({ word: scriptWord.original, start: null, end: null, matched: false });
      continue;
    }
    
    // Look ahead in transcript for a match (within a window)
    const maxLookahead = Math.min(timedWords.length, transcriptIdx + 15);
    let bestMatch = -1;
    
    for (let j = transcriptIdx; j < maxLookahead; j++) {
      if (timedWords[j].normalized === scriptWord.normalized) {
        bestMatch = j;
        break;
      }
    }
    
    if (bestMatch >= 0) {
      aligned.push({
        word: scriptWord.original,
        start: timedWords[bestMatch].start,
        end: timedWords[bestMatch].end,
        matched: true,
      });
      transcriptIdx = bestMatch + 1;
      matchCount++;
    } else {
      aligned.push({ word: scriptWord.original, start: null, end: null, matched: false });
    }
  }
  
  // Interpolate timing for unmatched words
  interpolateTimings(aligned);
  
  // Calculate match percentage
  const meaningfulScriptWords = scriptWords.filter(w => w.normalized.length > 0).length;
  const matchPercentage = meaningfulScriptWords > 0
    ? Math.round((matchCount / meaningfulScriptWords) * 100)
    : 0;
  
  // Convert aligned words to WordTiming array
  const wordTimings: WordTiming[] = aligned
    .filter(w => w.start !== null && w.end !== null)
    .map(w => ({
      word: w.word,
      start: w.start!,
      end: w.end!,
    }));
  
  // Build transcript segments from aligned words
  if (wordTimings.length === 0) {
    return { segments: [], matchPercentage };
  }
  
  // Group words back into segments based on sentence boundaries
  const segments: TranscriptSegment[] = [];
  let currentWords: WordTiming[] = [];
  
  for (const wt of wordTimings) {
    currentWords.push(wt);
    
    // Break on sentence-ending punctuation
    if (/[.!?]$/.test(wt.word)) {
      segments.push({
        startTime: currentWords[0].start,
        endTime: currentWords[currentWords.length - 1].end,
        text: currentWords.map(w => w.word).join(' '),
        words: [...currentWords],
      });
      currentWords = [];
    }
  }
  
  // Remaining words
  if (currentWords.length > 0) {
    segments.push({
      startTime: currentWords[0].start,
      endTime: currentWords[currentWords.length - 1].end,
      text: currentWords.map(w => w.word).join(' '),
      words: [...currentWords],
    });
  }
  
  return { segments, matchPercentage };
}

function interpolateTimings(aligned: { word: string; start: number | null; end: number | null; matched: boolean }[]) {
  // Forward pass: fill from last known timing
  let lastStart: number | null = null;
  let lastEnd: number | null = null;
  
  for (let i = 0; i < aligned.length; i++) {
    if (aligned[i].matched) {
      lastStart = aligned[i].start;
      lastEnd = aligned[i].end;
    } else if (lastEnd !== null) {
      // Find next matched word
      let nextStart: number | null = null;
      let nextEnd: number | null = null;
      let gapCount = 0;
      
      for (let j = i; j < aligned.length; j++) {
        if (aligned[j].matched) {
          nextStart = aligned[j].start;
          nextEnd = aligned[j].end;
          gapCount = j - i;
          break;
        }
      }
      
      if (nextStart !== null && gapCount > 0) {
        // Interpolate between lastEnd and nextStart
        const totalGap = nextStart - lastEnd;
        const step = totalGap / (gapCount + 1);
        
        for (let k = 0; k < gapCount; k++) {
          const idx = i + k;
          if (!aligned[idx].matched) {
            aligned[idx].start = lastEnd + step * (k + 1) - step * 0.8;
            aligned[idx].end = lastEnd + step * (k + 1);
          }
        }
      } else {
        // No next match — extend from last known timing
        const avgWordDuration = 0.3; // ~300ms per word
        aligned[i].start = lastEnd;
        aligned[i].end = lastEnd + avgWordDuration;
        lastEnd = aligned[i].end;
      }
    }
  }
  
  // Backward pass: fill any remaining nulls at the start
  let firstStart: number | null = null;
  for (const a of aligned) {
    if (a.start !== null) {
      firstStart = a.start;
      break;
    }
  }
  
  if (firstStart !== null) {
    const avgWordDuration = 0.3;
    for (let i = aligned.length - 1; i >= 0; i--) {
      if (aligned[i].start !== null) break;
    }
    
    // Fill from beginning
    for (let i = 0; i < aligned.length; i++) {
      if (aligned[i].start !== null) break;
      aligned[i].start = Math.max(0, firstStart - (i + 1) * avgWordDuration);
      aligned[i].end = aligned[i].start! + avgWordDuration;
    }
  }
}
