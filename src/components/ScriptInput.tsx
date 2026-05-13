import { useState, useRef } from 'react';
import { ChevronDown, Upload, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ScriptInputProps {
  scriptText: string;
  onScriptChange: (text: string) => void;
}

export function ScriptInput({ scriptText, onScriptChange }: ScriptInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      onScriptChange(event.target?.result as string);
    };
    reader.readAsText(file);

    // Reset input so the same file can be selected again
    e.target.value = '';
  };

  const handleClear = () => {
    onScriptChange('');
  };

  return (
    <div className="rounded-lg bg-secondary/50 border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-secondary/70 transition-colors"
        aria-expanded={isOpen}
      >
        <span className="text-sm font-medium text-foreground">Reference Script (optional)</span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-4">
          <Textarea
            value={scriptText}
            onChange={(e) => onScriptChange(e.target.value)}
            placeholder="Paste your narration script here. The app will use it to correct spelling and acronyms in your captions. Works best when the script closely matches the audio."
            rows={6}
            className="w-full resize-y"
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2"
              >
                <Upload className="w-4 h-4" />
                Upload .txt file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,text/plain"
                onChange={handleFileUpload}
                className="hidden"
              />

              {scriptText.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  className="gap-2 text-muted-foreground hover:text-destructive"
                >
                  <X className="w-4 h-4" />
                  Clear
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {scriptText.length} characters
              </span>
              {scriptText.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-green-500">
                  <Check className="w-3 h-3" />
                  Script ready
                </span>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Tip: Acronyms and proper nouns in your script will be used to correct the transcription.
          </p>
        </div>
      )}
    </div>
  );
}
