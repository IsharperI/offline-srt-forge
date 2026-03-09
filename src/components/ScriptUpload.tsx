import { useState } from 'react';
import { FileText, X, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface ScriptUploadProps {
  scriptText: string | null;
  onScriptChange: (text: string | null) => void;
  disabled: boolean;
}

export function ScriptUpload({ scriptText, onScriptChange, disabled }: ScriptUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const wordCount = scriptText
    ? scriptText.split(/\s+/).filter(w => w.length > 0).length
    : 0;

  const handlePasteApply = () => {
    const trimmed = pasteText.trim();
    if (!trimmed) {
      onScriptChange(null);
      return;
    }
    onScriptChange(trimmed);
  };

  const handleClear = () => {
    onScriptChange(null);
    setPasteText('');
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          className="flex items-center gap-2 w-full text-left text-sm font-medium text-foreground hover:text-primary transition-colors py-1 disabled:opacity-50"
          disabled={disabled}
        >
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <FileText className="w-4 h-4" />
          <span>Reference Script</span>
          {scriptText && (
            <span className="ml-auto text-xs text-muted-foreground font-normal">
              {wordCount} words loaded
            </span>
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Paste a reference script to correct transcription wording. Each audio file will automatically match to its corresponding portion of the script.
        </p>

        <Textarea
          placeholder="Paste your full script here... Each audio file will be matched to its corresponding sentence(s) automatically."
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          className="min-h-[100px] text-sm"
          disabled={disabled}
        />

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePasteApply}
            disabled={disabled || !pasteText.trim()}
          >
            Apply Script
          </Button>

          {scriptText && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={disabled}
              className="gap-1.5 text-muted-foreground hover:text-destructive ml-auto"
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </Button>
          )}
        </div>

        {scriptText && (
          <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2">
            <p className="text-xs text-primary font-medium">
              ✓ Script loaded — {wordCount} words. Each audio file will be matched to its portion automatically.
            </p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
