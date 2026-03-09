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

async function extractDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    // .docx files are ZIP archives; use DecompressionStream to extract document.xml
    const blob = new Blob([arrayBuffer]);
    // Simple approach: read as text and try to find XML content
    // For proper DOCX support, we'd need a zip library. For now, try basic extraction.
    const bytes = new Uint8Array(arrayBuffer);
    
    // Check for ZIP magic number
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
      throw new Error('Not a valid DOCX file');
    }

    // Use the browser's built-in zip support isn't available, so we do a basic approach:
    // Find word/document.xml in the zip and extract text from XML tags
    const text = new TextDecoder().decode(arrayBuffer);
    
    // Find <w:t> tags which contain the actual text content in DOCX
    const matches = text.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    if (!matches || matches.length === 0) {
      throw new Error('Could not extract text from DOCX file');
    }

    // Extract text content from tags, joining with spaces
    const extracted = matches
      .map(m => {
        const match = m.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
        return match ? match[1] : '';
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!extracted) {
      throw new Error('DOCX file appears to be empty');
    }

    return extracted;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('Failed to parse DOCX file');
  }
}

export function ScriptUpload({ scriptText, onScriptChange, disabled }: ScriptUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const wordCount = scriptText
    ? scriptText.split(/\s+/).filter(w => w.length > 0).length
    : 0;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (file.name.endsWith('.txt')) {
        const text = await file.text();
        if (!text.trim()) {
          toast({ title: 'Empty file', description: 'The uploaded file contains no text.', variant: 'destructive' });
          return;
        }
        onScriptChange(text.trim());
        setPasteText(text.trim());
      } else if (file.name.endsWith('.docx')) {
        const buffer = await file.arrayBuffer();
        const text = await extractDocxText(buffer);
        onScriptChange(text);
        setPasteText(text);
      } else {
        toast({ title: 'Unsupported format', description: 'Please upload a .txt or .docx file.', variant: 'destructive' });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to read file';
      toast({ title: 'File error', description: msg, variant: 'destructive' });
    }

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

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

        {/* Textarea for pasting */}
        <Textarea
          placeholder="Paste your full script here... Each audio file will be matched to its corresponding sentence(s) automatically."
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          className="min-h-[100px] text-sm"
          disabled={disabled}
        />

        <div className="flex items-center gap-2 flex-wrap">
          {/* Apply pasted text */}
          <Button
            variant="outline"
            size="sm"
            onClick={handlePasteApply}
            disabled={disabled || !pasteText.trim()}
          >
            Apply Script
          </Button>

          {/* Clear */}
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
              ✓ Script loaded — {wordCount} words. Transcription will be aligned to this script.
            </p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
