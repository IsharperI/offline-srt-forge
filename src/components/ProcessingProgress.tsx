import { Loader2, AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TranscriptionProgress } from '@/lib/transcription';
import { Button } from '@/components/ui/button';

interface ProcessingProgressProps {
  filename: string;
  progress: TranscriptionProgress;
  onRemove?: () => void;
}

export function ProcessingProgress({ filename, progress, onRemove }: ProcessingProgressProps) {
  const isError = progress.status === 'error';
  
  return (
    <div className={cn(
      "bg-card border rounded-lg p-4 animate-slide-up",
      isError ? "border-destructive/50" : "border-border"
    )}>
      <div className="flex items-center gap-3 mb-3">
        <div className="relative">
          {isError ? (
            <AlertCircle className="w-5 h-5 text-destructive" />
          ) : (
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate font-mono">
            {filename}
          </p>
          <p className={cn(
            "text-xs",
            isError ? "text-destructive" : "text-muted-foreground"
          )}>
            {progress.message}
          </p>
        </div>
        
        {isError && onRemove && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRemove}
            className="flex-shrink-0 text-muted-foreground hover:text-destructive"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
      
      {!isError && (
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
      )}
    </div>
  );
}
