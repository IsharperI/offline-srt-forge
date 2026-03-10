import { useState, useRef } from 'react';
import { FileText, X, ChevronDown, ChevronRight, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from '@/hooks/use-toast';

interface ScriptUploadProps {
  scriptText: string | null;
  onScriptChange: (text: string | null) => void;
  disabled: boolean;
}

async function extractDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const blob = new Blob([arrayBuffer], { type: 'application/zip' });
    const ds = new DecompressionStream('deflate-raw');
    // Try using the ZIP structure to find word/document.xml
    const bytes = new Uint8Array(arrayBuffer);
    const textDecoder = new TextDecoder();
    const fullText = textDecoder.decode(bytes);
    
    // Find the document.xml content between PK headers
    const xmlMatch = fullText.match(/<w:body[\s\S]*?<\/w:body>/);
    if (xmlMatch) {
      // Strip XML tags and extract text content
      const bodyXml = xmlMatch[0];
      const textParts: string[] = [];
      const regex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let match;
      while ((match = regex.exec(bodyXml)) !== null) {
        textParts.push(match[1]);
      }
      if (textParts.length > 0) {
        return textParts.join('');
      }
    }

    // Fallback: extract all w:t tags from the raw bytes
    const allText = textDecoder.decode(bytes);
    const parts: string[] = [];
    const fallbackRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let m;
    while ((m = fallbackRegex.exec(allText)) !== null) {
      parts.push(m[1]);
    }
    return parts.join('') || '';
  } catch {
    return '';
  }
}

export function ScriptUpload({ scriptText, onScriptChange, disabled }: ScriptUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const name = file.name.toLowerCase();

    try {
      if (name.endsWith('.txt')) {
        const text = await file.text();
        const trimmed = text.trim();
        if (!trimmed) {
          toast({ title: 'Empty file', description: 'The uploaded file contains no text.', variant: 'destructive' });
          return;
        }
        setPasteText(trimmed);
        onScriptChange(trimmed);
      } else if (name.endsWith('.docx') || name.endsWith('.doc')) {
        const buffer = await file.arrayBuffer();
        const text = await extractDocxText(buffer);
        const trimmed = text.trim();
        if (!trimmed) {
          toast({ title: 'Could not extract text', description: 'Unable to read text from this document. Try a .txt file instead.', variant: 'destructive' });
          return;
        }
        setPasteText(trimmed);
        onScriptChange(trimmed);
      } else {
        toast({ title: 'Unsupported format', description: 'Please upload a .txt or .docx file.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error reading file', description: 'Could not read the uploaded file.', variant: 'destructive' });
    }

    // Reset input so same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = '';
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
          Paste or upload a reference script to correct transcription wording. Each audio file will automatically match to its corresponding portion of the script.
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

          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload .txt / .docx
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.docx,.doc"
            onChange={handleFileUpload}
            className="hidden"
          />

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
