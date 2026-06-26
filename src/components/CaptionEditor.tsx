import { useState, useEffect, useRef } from 'react';
import { Check, X, Clock, Edit2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { TranscriptSegment } from '@/lib/transcription';
import { autoCorrect, CorrectionResult } from '@/lib/spellcheck';

interface CaptionEditorProps {
  filename: string;
  segments: TranscriptSegment[];
  onGenerate: (segments: TranscriptSegment[]) => void;
  onCancel: () => void;
  matchRate?: number | null;
  scriptWasUseful?: boolean;
  customCorrections?: Record<string, string>;
}

interface SegmentWithCorrections extends TranscriptSegment {
  corrections?: CorrectionResult['corrections'];
}

const formatTimestamp = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${secs.padStart(4, '0')}`;
};

const parseTimestamp = (value: string): number | null => {
  const match = value.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (match) {
    const mins = parseInt(match[1], 10);
    const secs = parseFloat(match[2]);
    return mins * 60 + secs;
  }
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
};

// Render text with corrected words highlighted in pink (dictionary autoCorrect)
// and amber/yellow (user-defined custom corrections).
function HighlightedText({
  text,
  corrections,
  customCorrections,
}: {
  text: string;
  corrections?: CorrectionResult['corrections'];
  customCorrections?: Record<string, string>;
}) {
  const correctedWords = new Set((corrections ?? []).map(c => c.corrected.toLowerCase()));
  const customKeys = new Set(Object.keys(customCorrections ?? {}).map(k => k.toLowerCase()));

  if (correctedWords.size === 0 && customKeys.size === 0) {
    return <>{text}</>;
  }

  // Split text into words and whitespace, preserving both
  const parts = text.split(/(\s+)/);

  return (
    <>
      {parts.map((part, index) => {
        const isWord = part.trim().length > 0;
        const lower = part.toLowerCase();

        if (isWord && customKeys.has(lower)) {
          return (
            <span
              key={index}
              className="text-amber-500 font-medium"
              title="Custom correction match"
            >
              {part}
            </span>
          );
        }

        if (isWord && correctedWords.has(lower)) {
          correctedWords.delete(lower);
          return (
            <span
              key={index}
              className="text-pink-500 font-medium"
              title="Auto-corrected"
            >
              {part}
            </span>
          );
        }

        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

export function CaptionEditor({ filename, segments: initialSegments, onGenerate, onCancel, matchRate, scriptWasUseful, customCorrections }: CaptionEditorProps) {
  const [segments, setSegments] = useState<SegmentWithCorrections[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [editError, setEditError] = useState<string>('');
  const segmentsRef = useRef<SegmentWithCorrections[]>([]);

  // Auto-correct segments on initial load
  useEffect(() => {
    const correctedSegments = initialSegments.map(segment => {
      const result = autoCorrect(segment.text);
      return {
        ...segment,
        text: result.correctedText,
        corrections: result.corrections,
      };
    });
    segmentsRef.current = correctedSegments;
    setSegments(correctedSegments);
  }, [initialSegments]);

  const startEditing = (index: number) => {
    const segment = segments[index];
    setEditingIndex(index);
    setEditText(segment.text);
    setEditStart(formatTimestamp(segment.startTime));
    setEditEnd(formatTimestamp(segment.endTime));
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    
    const startTime = parseTimestamp(editStart);
    const endTime = parseTimestamp(editEnd);
    
    if (startTime === null || endTime === null) {
      setEditError('Invalid timestamp format. Use M:SS.S (e.g. 1:23.4)');
      return;
    }
    if (startTime >= endTime) {
      setEditError('Start time must be before end time');
      return;
    }
    setEditError('');
    
    // Save user's edited text as-is (no auto-correct on manual edits)
    // Clear corrections since user has manually reviewed/edited
    const newSegments = segments.map((seg, i) => 
      i === editingIndex
        ? { 
            ...seg, 
            text: editText.trim(), 
            startTime, 
            endTime,
            corrections: [], // Clear highlights after manual edit
          }
        : seg
    );
    segmentsRef.current = newSegments;
    setSegments(newSegments);
    setEditingIndex(null);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditError('');
  };

  const deleteSegment = (index: number) => {
    const newSegments = segments.filter((_, i) => i !== index);
    segmentsRef.current = newSegments;
    setSegments(newSegments);
    if (editingIndex === index) {
      setEditingIndex(null);
    }
  };

  const handleGenerate = () => {
    const validSegments = segmentsRef.current.filter(s => s.text.trim());
    onGenerate(validSegments);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/50">
        <div className="flex items-center gap-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <div>
            <h3 className="font-medium text-foreground text-sm">{filename}</h3>
            <p className="text-xs text-muted-foreground">
              {segments.length} caption{segments.length !== 1 ? 's' : ''} — {isOpen ? 'click arrow to hide' : 'click arrow to preview/edit'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={segments.length === 0}>
            <Check className="w-4 h-4 mr-1" />
            Generate SRT
          </Button>
        </div>
      </div>

      {scriptWasUseful === true && matchRate !== null && matchRate !== undefined && matchRate < 0.75 && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-500 font-medium">
            ⚠️ Less than 75% of this file matched the reference script. Please double-check that the correct script was used.
          </p>
        </div>
      )}


      <CollapsibleContent>
        <div className="border-t border-border">
          <ScrollArea className="h-[400px]">
            <div className="p-2 space-y-2">
              {segments.map((segment, index) => (
                <div key={index} className="border border-border rounded-md bg-background">
                  {editingIndex === index ? (
                    <div className="p-3 space-y-3">
                      <div className="flex gap-2 items-center text-xs">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <Input
                          value={editStart}
                          onChange={(e) => setEditStart(e.target.value)}
                          className="w-20 h-7 text-xs"
                          placeholder="0:00.0"
                        />
                        <span className="text-muted-foreground">→</span>
                        <Input
                          value={editEnd}
                          onChange={(e) => setEditEnd(e.target.value)}
                          className="w-20 h-7 text-xs"
                          placeholder="0:00.0"
                        />
                      </div>
                      {editError && (
                        <p className="text-xs text-red-500">{editError}</p>
                      )}
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="min-h-[80px] text-sm resize-none"
                        autoFocus
                        spellCheck={true}
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={cancelEdit}>
                          <X className="w-4 h-4" />
                        </Button>
                        <Button size="sm" onClick={saveEdit}>
                          <Check className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div 
                      className="p-3 cursor-pointer hover:bg-muted/50 transition-colors group"
                      onClick={() => startEditing(index)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground font-mono">
                          {formatTimestamp(segment.startTime)} → {formatTimestamp(segment.endTime)}
                        </span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); startEditing(index); }}>
                            <Edit2 className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); deleteSegment(index); }}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm text-foreground">
                        <HighlightedText text={segment.text} corrections={segment.corrections} customCorrections={customCorrections} />
                      </p>
                    </div>
                  )}
                </div>
              ))}
              
              {segments.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No captions to display
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
