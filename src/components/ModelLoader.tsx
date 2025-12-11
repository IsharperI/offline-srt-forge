import { Loader2, Cpu } from 'lucide-react';
import { TranscriptionProgress } from '@/lib/transcription';

interface ModelLoaderProps {
  progress: TranscriptionProgress;
}

export function ModelLoader({ progress }: ModelLoaderProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 flex flex-col items-center gap-4">
      <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
        <Cpu className="w-7 h-7 text-primary animate-pulse-glow" />
      </div>
      
      <div className="text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          Loading Speech Recognition Model
        </p>
        <p className="text-xs text-muted-foreground">
          This runs entirely in your browser
        </p>
      </div>
      
      <div className="w-full max-w-xs">
        <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300 progress-glow"
            style={{ width: `${progress.progress}%` }}
          />
          {progress.progress === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2">
          {progress.message}
        </p>
      </div>
    </div>
  );
}
