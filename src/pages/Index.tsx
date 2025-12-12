import { useState, useCallback, useRef } from 'react';
import { AudioWaveform, Shield, Zap, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileDropzone } from '@/components/FileDropzone';
import { ProcessingProgress } from '@/components/ProcessingProgress';
import { ProcessedFile } from '@/components/ProcessedFile';
import { ModelLoader } from '@/components/ModelLoader';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  transcribeAudio,
  sanitizeSegments,
  generateSRT,
  downloadSRT,
  getAudioDuration,
  TranscriptionProgress,
} from '@/lib/transcription';

interface ProcessedFileData {
  id: string;
  filename: string;
  duration: number;
  srtContent: string;
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

const Index = () => {
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState<TranscriptionProgress>({
    status: 'loading',
    progress: 0,
    message: 'Initializing...',
  });
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const [completedFiles, setCompletedFiles] = useState<ProcessedFileData[]>([]);
  const [maxCharLimit, setMaxCharLimit] = useState(80);
  
  // Queue for sequential processing
  const fileQueueRef = useRef<QueuedFile[]>([]);
  const isProcessingRef = useRef(false);

  const processNextInQueue = useCallback(async () => {
    if (isProcessingRef.current || fileQueueRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    const { id: fileId, file } = fileQueueRef.current[0];

    try {
      // Get duration
      const duration = await getAudioDuration(file);

      // Transcribe with progress updates
      const updateProgress = (progress: TranscriptionProgress) => {
        if (progress.status === 'loading') {
          setIsModelLoading(true);
          setModelProgress(progress);
        }
        if (progress.status !== 'loading') {
          setIsModelLoading(false);
        }
        setProcessingFiles(prev =>
          prev.map(f =>
            f.id === fileId ? { ...f, progress } : f
          )
        );
      };

      // Step A: Raw transcription
      const rawSegments = await transcribeAudio(file, updateProgress);

      // Step B: Sanitization
      const cleanedSegments = sanitizeSegments(rawSegments);

      // Step C: Generate SRT (with re-indexing, duration clamping, and char limit)
      const srtContent = generateSRT(cleanedSegments, duration, maxCharLimit);

      // Remove from processing, add to completed
      setProcessingFiles(prev => prev.filter(f => f.id !== fileId));
      setCompletedFiles(prev => [
        ...prev,
        {
          id: fileId,
          filename: file.name,
          duration,
          srtContent,
        },
      ]);
    } catch (error) {
      console.error('Transcription error:', error);
      
      // Generate a helpful error message
      let errorMessage = 'Transcription failed';
      if (error instanceof Error) {
        if (error.message.includes('empty')) {
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

    // Remove from queue and process next
    fileQueueRef.current = fileQueueRef.current.slice(1);
    isProcessingRef.current = false;
    
    // Process next file if any
    if (fileQueueRef.current.length > 0) {
      processNextInQueue();
    }
  }, [maxCharLimit]);

  const handleFilesSelected = useCallback((files: File[]) => {
    // Add all files to the queue and processing list
    const newQueuedFiles: QueuedFile[] = files.map(file => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
    }));

    // Add to processing list with "Queued" status
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

    // Add to queue
    fileQueueRef.current = [...fileQueueRef.current, ...newQueuedFiles];

    // Start processing if not already
    processNextInQueue();
  }, [processNextInQueue]);

  const handleDownload = (file: ProcessedFileData) => {
    downloadSRT(file.srtContent, file.filename);
  };

  const handleExportAll = () => {
    completedFiles.forEach((file, index) => {
      // Stagger downloads slightly to prevent browser blocking
      setTimeout(() => {
        downloadSRT(file.srtContent, file.filename);
      }, index * 100);
    });
  };

  const handleRemoveProcessing = (fileId: string) => {
    setProcessingFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const handleRemoveCompleted = (fileId: string) => {
    setCompletedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const isProcessing = processingFiles.length > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <AudioWaveform className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">SRT Generator</h1>
              <p className="text-xs text-muted-foreground">Offline Audio Transcription</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Features Banner */}
        <div className="flex flex-wrap justify-center gap-6 mb-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="w-4 h-4 text-success" />
            <span>100% Offline</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap className="w-4 h-4 text-primary" />
            <span>Browser-Based AI</span>
          </div>
        </div>

        {/* Model Loading State */}
        {isModelLoading && (
          <div className="mb-6">
            <ModelLoader progress={modelProgress} />
          </div>
        )}

        {/* Character Limit Setting */}
        {!isModelLoading && (
          <div className="mb-4 p-4 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center gap-4">
              <Label htmlFor="charLimit" className="text-sm font-medium text-foreground whitespace-nowrap">
                Max characters per caption:
              </Label>
              <Input
                id="charLimit"
                type="number"
                min={20}
                max={200}
                value={maxCharLimit}
                onChange={(e) => setMaxCharLimit(Math.max(20, Math.min(200, parseInt(e.target.value) || 80)))}
                className="w-24"
                disabled={isProcessing}
              />
              <span className="text-xs text-muted-foreground">
                (20-200)
              </span>
            </div>
          </div>
        )}

        {/* Upload Zone */}
        {!isModelLoading && (
          <div className="mb-6">
            <FileDropzone
              onFilesSelected={handleFilesSelected}
              disabled={isProcessing}
            />
          </div>
        )}

        {/* Processing Queue */}
        {processingFiles.length > 0 && (
          <div className="space-y-3 mb-6">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Processing
            </h2>
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

        {/* Completed Files */}
        {completedFiles.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Ready to Download
              </h2>
              {completedFiles.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportAll}
                  className="gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export All ({completedFiles.length})
                </Button>
              )}
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

        {/* Empty State Info */}
        {!isModelLoading && processingFiles.length === 0 && completedFiles.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              Your files are processed entirely in your browser.
              <br />
              No data is uploaded to any server.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-auto">
        <div className="container mx-auto px-4 py-4">
          <p className="text-xs text-muted-foreground text-center">
            All transcription is performed locally using WebAssembly-based speech recognition.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
