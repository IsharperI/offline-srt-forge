import { FileAudio, Download, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDuration } from '@/lib/transcription';

interface ProcessedFileProps {
  filename: string;
  duration: number;
  onDownload: () => void;
  onRemove: () => void;
}

export function ProcessedFile({ filename, duration, onDownload, onRemove }: ProcessedFileProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-4 animate-slide-up">
      <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0">
        <FileAudio className="w-5 h-5 text-success" />
      </div>
      
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate font-mono">
          {filename}
        </p>
        <p className="text-xs text-muted-foreground font-mono">
          Duration: {formatDuration(duration)}
        </p>
      </div>
      
      <Badge variant="secondary" className="bg-success/10 text-success border-success/20 gap-1.5 flex-shrink-0">
        <Check className="w-3 h-3" />
        Cleaned & Ready
      </Badge>
      
      <Button
        size="sm"
        onClick={onDownload}
        className="flex-shrink-0 gap-2"
      >
        <Download className="w-4 h-4" />
        Download SRT
      </Button>
      
      <Button
        size="sm"
        variant="ghost"
        onClick={onRemove}
        className="flex-shrink-0 text-muted-foreground hover:text-destructive"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
