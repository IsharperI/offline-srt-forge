

# Add "Reference Script" Tab

## Overview

Add a tabbed interface to the main page. The existing transcription workflow lives under "Audio Transcription." A new "Reference Script" tab lets users paste or upload a script (.txt or .docx), upload audio files, and the app aligns the script text to audio timestamps using Whisper for timing only.

An "Export Script Template" button downloads a sample .txt file showing the recommended formatting conventions.

## Architecture

### File changes

| File | Action |
|------|--------|
| `src/pages/Index.tsx` | Wrap content in `<Tabs>`, extract existing logic to `TranscriptionTab`, add `ReferenceScriptTab` |
| `src/components/TranscriptionTab.tsx` | New — all existing transcription logic moved here verbatim |
| `src/components/ReferenceScriptTab.tsx` | New — reference script workflow |
| `src/components/ScriptInput.tsx` | New — textarea + .txt/.docx file upload + template export button |
| `src/lib/scriptAlignment.ts` | New — alignment algorithm + DOCX text extraction + template generation |

### Index.tsx restructure

The header, features banner, and footer stay in `Index.tsx`. The main content area becomes:

```text
<Tabs defaultValue="transcription">
  <TabsList>
    <TabsTrigger value="transcription">Audio Transcription</TabsTrigger>
    <TabsTrigger value="reference">Reference Script</TabsTrigger>
  </TabsList>
  <TabsContent value="transcription">
    <TranscriptionTab />
  </TabsContent>
  <TabsContent value="reference">
    <ReferenceScriptTab />
  </TabsContent>
</Tabs>
```

### TranscriptionTab.tsx

All existing state, handlers, and JSX from `Index.tsx` (model loading, file queue, processing, review, completed sections) moves here unchanged. Shared settings (model selector, char limit) live inside each tab independently so they can be configured per-workflow.

### ScriptInput.tsx

- A `<Textarea>` for pasting script text directly
- A file upload button accepting `.txt` and `.docx` files
- For `.txt`: read via `FileReader.readAsText()`
- For `.docx`: extract text from the ZIP's `word/document.xml` using browser-native `DecompressionStream` API — strip XML tags to get plain text. No new dependencies.
- An "Export Script Template" button that downloads a `.txt` file with formatting guidelines and an example script structure

### Script template content

The exported template file will contain:

```text
=== SRT GENERATOR - SCRIPT TEMPLATE ===

FORMAT GUIDELINES:
- Write one sentence per line
- Use blank lines to separate paragraphs or scenes
- Punctuation matters: periods, commas, and question marks
  help the AI break captions at natural points
- Speaker labels (optional): prefix lines with "SPEAKER:"

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
```

### ReferenceScriptTab.tsx

Workflow:
1. User inputs script (paste or upload .txt/.docx) via `ScriptInput`
2. User uploads audio file(s) via the existing `FileDropzone` component
3. App runs Whisper on each audio file (reuses `transcribeAudio` + progress UI)
4. Alignment: calls `alignScriptToAudio()` to match script words to transcribed timestamps
5. If match percentage < 70%, shows an `AlertDialog`: "Script does not closely match audio (X% match). Use raw transcription instead?" with "Use Raw Transcription" and "Cancel" options
6. Results go through the same Review & Edit (`CaptionEditor`) and Download flow

### scriptAlignment.ts

**`extractTextFromDocx(file: File): Promise<string>`**
- Uses `DecompressionStream` to unzip the .docx
- Finds `word/document.xml` entry
- Strips XML tags, returns plain text

**`alignScriptToAudio(scriptText: string, transcribedSegments: TranscriptSegment[]): AlignmentResult`**
- Flattens transcript into word list with timestamps
- Normalizes both script and transcript words (lowercase, strip punctuation)
- Sequential greedy match: for each script word, find the next matching transcript word, inherit its timestamp
- Unmatched script words get interpolated timing from surrounding matches
- Returns `{ segments: TranscriptSegment[], matchPercentage: number }`

**`generateScriptTemplate(): string`**
- Returns the template text content shown above

**`downloadScriptTemplate(): void`**
- Creates a Blob and triggers download of `script-template.txt`

The aligned segments feed into the existing `generateSRT` pipeline (semantic breaks, char limits, anti-orphan) unchanged.

