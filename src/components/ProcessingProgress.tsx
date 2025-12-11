import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TranscriptionProgress } from '@/lib/transcription';

interface ProcessingProgressProps {
  filename: string;
  progress: TranscriptionProgress;
}

export function ProcessingProgress({ filename, progress }: ProcessingProgressProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 animate-slide-up">
      <div className="flex items-center gap-3 mb-3">
        <div className="relative">
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate font-mono">
            {filename}
          </p>
          <p className="text-xs text-muted-foreground">
            {progress.message}
          </p>
        </div>
      </div>
      
      <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className={cn(
            'absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300',
            progress.progress > 0 && 'progress-glow'
          )}
          style={{ width: `${progress.progress}%` }}
        />
        {progress.status === 'loading' && progress.progress === 0 && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-pulse" />
        )}
      </div>
    </div>
  );
}
