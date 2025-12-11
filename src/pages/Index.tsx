import { useState, useCallback } from 'react';
import { AudioWaveform, Shield, Zap } from 'lucide-react';
import { FileDropzone } from '@/components/FileDropzone';
import { ProcessingProgress } from '@/components/ProcessingProgress';
import { ProcessedFile } from '@/components/ProcessedFile';
import { ModelLoader } from '@/components/ModelLoader';
import {
  transcribeAudio,
  sanitizeSegments,
  generateSRT,
  downloadSRT,
  getAudioDuration,
  TranscriptionProgress,
  TranscriptSegment,
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

const Index = () => {
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState<TranscriptionProgress>({
    status: 'loading',
    progress: 0,
    message: 'Initializing...',
  });
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const [completedFiles, setCompletedFiles] = useState<ProcessedFileData[]>([]);

  const processFile = async (file: File) => {
    const fileId = `${file.name}-${Date.now()}`;
    
    // Add to processing list
    setProcessingFiles(prev => [
      ...prev,
      {
        id: fileId,
        filename: file.name,
        progress: { status: 'loading', progress: 0, message: 'Starting...' },
      },
    ]);

    try {
      // Get duration
      const duration = await getAudioDuration(file);

      // Transcribe with progress updates
      const updateProgress = (progress: TranscriptionProgress) => {
        if (progress.status === 'loading' && !isModelLoading) {
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

      // Step C: Generate SRT (with re-indexing)
      const srtContent = generateSRT(cleanedSegments);

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
  };

  const handleFilesSelected = useCallback((files: File[]) => {
    files.forEach(file => {
      processFile(file);
    });
  }, []);

  const handleDownload = (file: ProcessedFileData) => {
    downloadSRT(file.srtContent, file.filename);
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
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Ready to Download
            </h2>
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
