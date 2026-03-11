import { useState, useCallback, useRef } from 'react';
import { Download, FileText, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileDropzone } from '@/components/FileDropzone';
import { ProcessingProgress } from '@/components/ProcessingProgress';
import { ProcessedFile } from '@/components/ProcessedFile';
import { ModelLoader } from '@/components/ModelLoader';
import { CaptionEditor } from '@/components/CaptionEditor';
import { ModelSelector, PRESET_MODELS } from '@/components/ModelSelector';
import { ScriptInput } from '@/components/ScriptInput';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  transcribeAudio,
  sanitizeSegments,
  generateSRT,
  downloadSRT,
  getAudioDuration,
  TranscriptionProgress,
  TranscriptSegment,
} from '@/lib/transcription';
import { alignScriptToAudio } from '@/lib/scriptAlignment';

interface ProcessedFileData {
  id: string;
  filename: string;
  duration: number;
  srtContent: string;
}

interface ReviewFileData {
  id: string;
  filename: string;
  duration: number;
  segments: TranscriptSegment[];
}

interface ProcessingFile {
  id: string;
  filename: string;
  progress: TranscriptionProgress;
}

interface QueuedFile {
  id: string;
  file: File;
}

interface LowMatchPrompt {
  fileId: string;
  filename: string;
  matchPercentage: number;
  rawSegments: TranscriptSegment[];
  alignedSegments: TranscriptSegment[];
  duration: number;
}

export function ReferenceScriptTab() {
  const [scriptText, setScriptText] = useState('');
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState<TranscriptionProgress>({
    status: 'loading',
    progress: 0,
    message: 'Initializing...',
  });
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const [reviewFiles, setReviewFiles] = useState<ReviewFileData[]>([]);
  const [completedFiles, setCompletedFiles] = useState<ProcessedFileData[]>([]);
  const [maxCharLimit, setMaxCharLimit] = useState(80);
  const [selectedModel, setSelectedModel] = useState(PRESET_MODELS[0].id);
  const [lowMatchPrompt, setLowMatchPrompt] = useState<LowMatchPrompt | null>(null);

  const fileQueueRef = useRef<QueuedFile[]>([]);
  const isProcessingRef = useRef(false);

  const finishFile = useCallback((fileId: string, filename: string, duration: number, segments: TranscriptSegment[]) => {
    setProcessingFiles(prev => prev.filter(f => f.id !== fileId));
    setReviewFiles(prev => [
      ...prev,
      { id: fileId, filename, duration, segments },
    ]);
  }, []);

  const processNextInQueue = useCallback(async () => {
    if (isProcessingRef.current || fileQueueRef.current.length === 0) return;

    isProcessingRef.current = true;
    const { id: fileId, file } = fileQueueRef.current[0];

    try {
      const duration = await getAudioDuration(file);

      const updateProgress = (progress: TranscriptionProgress) => {
        if (progress.status === 'loading') {
          setIsModelLoading(true);
          setModelProgress(progress);
        }
        if (progress.status !== 'loading') {
          setIsModelLoading(false);
        }
        setProcessingFiles(prev =>
          prev.map(f => (f.id === fileId ? { ...f, progress } : f))
        );
      };

      const rawSegments = await transcribeAudio(file, updateProgress, selectedModel);
      const cleanedSegments = sanitizeSegments(rawSegments);

      if (scriptText.trim()) {
        // Align script to audio
        setProcessingFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? { ...f, progress: { status: 'processing', progress: 90, message: 'Aligning script to audio...' } }
              : f
          )
        );

        const { segments: alignedSegments, matchPercentage } = alignScriptToAudio(scriptText, cleanedSegments);

        if (matchPercentage < 70) {
          // Show confirmation dialog
          setLowMatchPrompt({
            fileId,
            filename: file.name,
            matchPercentage,
            rawSegments: cleanedSegments,
            alignedSegments,
            duration,
          });
          // Don't advance queue yet — wait for user decision
          return;
        }

        finishFile(fileId, file.name, duration, alignedSegments);
      } else {
        // No script — use raw transcription
        finishFile(fileId, file.name, duration, cleanedSegments);
      }
    } catch (error) {
      console.error('Transcription error:', error);

      let errorMessage = 'Transcription failed';
      if (error instanceof Error) {
        if (error.message.includes('Timed out')) {
          errorMessage = 'Processing timed out — file may be too long or corrupted';
        } else if (error.message.includes('empty')) {
          errorMessage = 'Audio file is empty or corrupted';
        } else if (error.message.includes('decode') || error.message.includes('audio')) {
          errorMessage = 'Unable to decode audio - format may be unsupported';
        } else if (error.message.includes('memory') || error.message.includes('OOM')) {
          errorMessage = 'File too large - try a shorter audio clip';
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
          errorMessage = 'Model loading failed - check your connection';
        } else {
          errorMessage = `Error: ${error.message.slice(0, 50)}`;
        }
      }

      setProcessingFiles(prev =>
        prev.map(f =>
          f.id === fileId
            ? { ...f, progress: { status: 'error', progress: 0, message: errorMessage } }
            : f
        )
      );
    }

    fileQueueRef.current = fileQueueRef.current.slice(1);
    isProcessingRef.current = false;

    if (fileQueueRef.current.length > 0) {
      processNextInQueue();
    }
  }, [selectedModel, scriptText, finishFile]);

  const handleLowMatchDecision = useCallback((useRaw: boolean) => {
    if (!lowMatchPrompt) return;

    const { fileId, filename, duration, rawSegments, alignedSegments } = lowMatchPrompt;

    finishFile(fileId, filename, duration, useRaw ? rawSegments : alignedSegments);
    setLowMatchPrompt(null);

    // Advance queue
    fileQueueRef.current = fileQueueRef.current.slice(1);
    isProcessingRef.current = false;

    if (fileQueueRef.current.length > 0) {
      processNextInQueue();
    }
  }, [lowMatchPrompt, finishFile, processNextInQueue]);

  const handleFilesSelected = useCallback((files: File[]) => {
    const newQueuedFiles: QueuedFile[] = files.map(file => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
    }));

    setProcessingFiles(prev => [
      ...prev,
      ...newQueuedFiles.map((qf, index) => ({
        id: qf.id,
        filename: qf.file.name,
        progress: {
          status: 'loading' as const,
          progress: 0,
          message: index === 0 && !isProcessingRef.current ? 'Starting...' : 'Queued...',
        },
      })),
    ]);

    fileQueueRef.current = [...fileQueueRef.current, ...newQueuedFiles];
    processNextInQueue();
  }, [processNextInQueue]);

  const handleGenerateSRT = useCallback((fileId: string, editedSegments: TranscriptSegment[]) => {
    const reviewFile = reviewFiles.find(f => f.id === fileId);
    if (!reviewFile) return;

    const srtContent = generateSRT(editedSegments, reviewFile.duration, maxCharLimit);

    setReviewFiles(prev => prev.filter(f => f.id !== fileId));
    setCompletedFiles(prev => [
      ...prev,
      { id: fileId, filename: reviewFile.filename, duration: reviewFile.duration, srtContent },
    ]);
  }, [reviewFiles, maxCharLimit]);

  const handleCancelReview = (fileId: string) => {
    setReviewFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const handleGenerateAll = useCallback(() => {
    reviewFiles.forEach(file => handleGenerateSRT(file.id, file.segments));
  }, [reviewFiles, handleGenerateSRT]);

  const handleDownload = (file: ProcessedFileData) => downloadSRT(file.srtContent, file.filename);

  const handleExportAll = () => {
    completedFiles.forEach((file, index) => {
      setTimeout(() => downloadSRT(file.srtContent, file.filename), index * 100);
    });
  };

  const handleRemoveProcessing = (fileId: string) => {
    setProcessingFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const handleRemoveCompleted = (fileId: string) => {
    setCompletedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const handleClearAllProcessing = () => setProcessingFiles([]);
  const handleClearAllReview = () => setReviewFiles([]);
  const handleClearAllCompleted = () => setCompletedFiles([]);

  const isProcessing = processingFiles.length > 0;
  const hasScript = scriptText.trim().length > 0;

  return (
    <div>
      {/* Model Loading State */}
      {isModelLoading && (
        <div className="mb-6">
          <ModelLoader progress={modelProgress} />
        </div>
      )}

      {/* Script Input */}
      {!isModelLoading && (
        <div className="mb-4 p-4 rounded-lg bg-secondary/50 border border-border">
          <ScriptInput
            scriptText={scriptText}
            onScriptChange={setScriptText}
            disabled={isProcessing}
          />
        </div>
      )}

      {/* Model & Settings */}
      {!isModelLoading && (
        <div className="mb-4 p-4 rounded-lg bg-secondary/50 border border-border space-y-4">
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            disabled={isProcessing || reviewFiles.length > 0}
          />
          <div className="flex items-center gap-4">
            <Label htmlFor="refCharLimit" className="text-sm font-medium text-foreground whitespace-nowrap">
              Max characters per caption:
            </Label>
            <Input
              id="refCharLimit"
              type="number"
              min={20}
              max={200}
              value={maxCharLimit}
              onChange={(e) => setMaxCharLimit(Math.max(20, Math.min(200, parseInt(e.target.value) || 80)))}
              className="w-24"
              disabled={isProcessing || reviewFiles.length > 0}
            />
            <span className="text-xs text-muted-foreground">(20-200)</span>
          </div>
        </div>
      )}

      {/* Upload Zone */}
      {!isModelLoading && (
        <div className="mb-6">
          <FileDropzone
            onFilesSelected={handleFilesSelected}
            disabled={isProcessing || reviewFiles.length > 0}
          />
          {!hasScript && (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              No script loaded — audio will be transcribed directly (same as Audio Transcription tab)
            </p>
          )}
        </div>
      )}

      {/* Processing Queue */}
      {processingFiles.length > 0 && (
        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Processing</h2>
            {processingFiles.length > 1 && (
              <Button variant="ghost" size="sm" onClick={handleClearAllProcessing} className="gap-2 text-muted-foreground hover:text-destructive">
                <Trash2 className="w-4 h-4" /> Clear All
              </Button>
            )}
          </div>
          {processingFiles.map(file => (
            <ProcessingProgress
              key={file.id}
              filename={file.filename}
              progress={file.progress}
              onRemove={() => handleRemoveProcessing(file.id)}
            />
          ))}
        </div>
      )}

      {/* Review/Edit Section */}
      {reviewFiles.length > 0 && (
        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Review & Edit</h2>
            <div className="flex items-center gap-2">
              {reviewFiles.length > 1 && (
                <Button variant="ghost" size="sm" onClick={handleClearAllReview} className="gap-2 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4" /> Clear All
                </Button>
              )}
              {reviewFiles.length > 1 && (
                <Button variant="outline" size="sm" onClick={handleGenerateAll} className="gap-2">
                  <FileText className="w-4 h-4" /> Generate All ({reviewFiles.length})
                </Button>
              )}
            </div>
          </div>
          {reviewFiles.map(file => (
            <CaptionEditor
              key={file.id}
              filename={file.filename}
              segments={file.segments}
              onGenerate={(segments) => handleGenerateSRT(file.id, segments)}
              onCancel={() => handleCancelReview(file.id)}
            />
          ))}
        </div>
      )}

      {/* Completed Files */}
      {completedFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Ready to Download</h2>
            <div className="flex items-center gap-2">
              {completedFiles.length > 1 && (
                <Button variant="ghost" size="sm" onClick={handleClearAllCompleted} className="gap-2 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4" /> Clear All
                </Button>
              )}
              {completedFiles.length > 1 && (
                <Button variant="outline" size="sm" onClick={handleExportAll} className="gap-2">
                  <Download className="w-4 h-4" /> Download All ({completedFiles.length})
                </Button>
              )}
            </div>
          </div>
          {completedFiles.map(file => (
            <ProcessedFile
              key={file.id}
              filename={file.filename}
              duration={file.duration}
              onDownload={() => handleDownload(file)}
              onRemove={() => handleRemoveCompleted(file.id)}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isModelLoading && processingFiles.length === 0 && reviewFiles.length === 0 && completedFiles.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">
            Paste or upload a reference script, then upload audio files.
            <br />
            The script text will be aligned to the audio timing.
          </p>
        </div>
      )}

      {/* Low Match Confirmation Dialog */}
      <AlertDialog open={!!lowMatchPrompt} onOpenChange={(open) => { if (!open) handleLowMatchDecision(true); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Low Script Match
            </AlertDialogTitle>
            <AlertDialogDescription>
              The reference script does not closely match the audio for{' '}
              <span className="font-medium text-foreground">{lowMatchPrompt?.filename}</span>{' '}
              ({lowMatchPrompt?.matchPercentage}% match).
              <br /><br />
              Would you like to use the raw audio transcription instead, or continue with the aligned script?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleLowMatchDecision(false)}>
              Use Aligned Script
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => handleLowMatchDecision(true)}>
              Use Raw Transcription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
