import { useCallback, useState } from 'react';
import { Upload, FileAudio } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/mp4', 'audio/m4a'];
const ACCEPTED_EXTENSIONS = ['.mp3', '.wav', '.m4a'];

export function FileDropzone({ onFilesSelected, disabled }: FileDropzoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  }, []);

  const validateFiles = (files: FileList | null): File[] => {
    if (!files) return [];
    
    return Array.from(files).filter(file => {
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();
      return ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.includes(extension);
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    if (disabled) return;
    
    const validFiles = validateFiles(e.dataTransfer.files);
    if (validFiles.length > 0) {
      onFilesSelected(validFiles);
    }
  }, [onFilesSelected, disabled]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    
    const validFiles = validateFiles(e.target.files);
    if (validFiles.length > 0) {
      onFilesSelected(validFiles);
    }
    // Reset input
    e.target.value = '';
  };

  return (
    <div
      className={cn(
        'relative rounded-xl border-2 border-dashed transition-all duration-300',
        'p-12 flex flex-col items-center justify-center gap-4',
        isDragActive
          ? 'border-primary dropzone-active glow-primary'
          : 'border-border hover:border-muted-foreground/50 dropzone-gradient',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        type="file"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        multiple
        onChange={handleChange}
        disabled={disabled}
      />
      
      <div className={cn(
        'w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300',
        isDragActive
          ? 'bg-primary/20 text-primary'
          : 'bg-secondary text-muted-foreground'
      )}>
        {isDragActive ? (
          <FileAudio className="w-8 h-8" />
        ) : (
          <Upload className="w-8 h-8" />
        )}
      </div>
      
      <div className="text-center">
        <p className="text-lg font-medium text-foreground">
          {isDragActive ? 'Drop your files here' : 'Drag audio files here or click to upload'}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Supports MP3, WAV, and M4A files
        </p>
      </div>
      
      <div className="flex gap-2 mt-2">
        {['.mp3', '.wav', '.m4a'].map((ext) => (
          <span
            key={ext}
            className="px-3 py-1 text-xs font-mono rounded-full bg-secondary text-muted-foreground"
          >
            {ext}
          </span>
        ))}
      </div>
    </div>
  );
}
