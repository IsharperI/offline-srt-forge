import { useRef } from 'react';
import { Upload, FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { extractTextFromDocx, downloadScriptTemplate } from '@/lib/scriptAlignment';

interface ScriptInputProps {
  scriptText: string;
  onScriptChange: (text: string) => void;
  disabled?: boolean;
}

const ACCEPTED_EXTENSIONS = '.txt,.docx';

export function ScriptInput({ scriptText, onScriptChange, disabled }: ScriptInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'txt') {
        const text = await file.text();
        onScriptChange(text);
      } else if (ext === 'docx') {
        const text = await extractTextFromDocx(file);
        onScriptChange(text);
      }
    } catch (error) {
      console.error('Error reading file:', error);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-foreground">
          Reference Script
        </Label>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={downloadScriptTemplate}
            className="gap-1.5 text-muted-foreground"
            disabled={disabled}
          >
            <Download className="w-3.5 h-3.5" />
            Export Template
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5"
            disabled={disabled}
          >
            <Upload className="w-3.5 h-3.5" />
            Upload .txt / .docx
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
      </div>

      <Textarea
        placeholder="Paste your script here, or upload a .txt or .docx file..."
        value={scriptText}
        onChange={(e) => onScriptChange(e.target.value)}
        disabled={disabled}
        className="min-h-[160px] resize-y font-mono text-sm"
      />

      {scriptText && (
        <p className="text-xs text-muted-foreground">
          <FileText className="w-3 h-3 inline mr-1" />
          {scriptText.split(/\s+/).filter(w => w.length > 0).length} words loaded
        </p>
      )}
    </div>
  );
}
