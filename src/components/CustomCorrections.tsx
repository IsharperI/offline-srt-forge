import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CustomCorrectionsProps {
  customCorrections: Record<string, string>;
  onAdd: (from: string, to: string) => void;
  onRemove: (from: string) => void;
}

export const CustomCorrections = ({ customCorrections, onAdd, onRemove }: CustomCorrectionsProps) => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const handleAdd = () => {
    const f = from.trim();
    const t = to.trim();
    if (!f) return;
    onAdd(f, t);
    setFrom('');
    setTo('');
  };

  const entries = Object.entries(customCorrections);

  return (
    <div className="p-4 rounded-lg bg-secondary/50 border border-border space-y-3">
      <Label className="text-sm font-medium text-foreground">Custom Corrections</Label>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[140px]">
          <Label htmlFor="cc-from" className="text-xs text-muted-foreground">Replace</Label>
          <Input
            id="cc-from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="e.g. teh"
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <Label htmlFor="cc-to" className="text-xs text-muted-foreground">With</Label>
          <Input
            id="cc-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="e.g. the"
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
        </div>
        <Button type="button" onClick={handleAdd} size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          Add
        </Button>
      </div>

      {entries.length > 0 && (
        <ul className="space-y-1">
          {entries.map(([f, t]) => (
            <li
              key={f}
              className="flex items-center justify-between px-3 py-2 rounded-md bg-background border border-border text-sm"
            >
              <span className="text-foreground">
                <span className="font-mono">{f}</span>
                <span className="text-muted-foreground"> → </span>
                <span className="font-mono">{t}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(f)}
                aria-label={`Remove correction ${f}`}
              >
                <X className="w-4 h-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
