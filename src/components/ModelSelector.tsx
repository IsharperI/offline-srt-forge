import { useState } from 'react';
import { ChevronDown, ExternalLink, Upload, AlertCircle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

// Regex pattern for valid Hugging Face model IDs: username/model-name
const HF_MODEL_ID_PATTERN = /^[\w-]+\/[\w.-]+$/;

// Validate Hugging Face model ID format
const isValidModelId = (modelId: string): boolean => {
  return HF_MODEL_ID_PATTERN.test(modelId.trim());
};

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  isCustom?: boolean;
}

export const PRESET_MODELS: ModelOption[] = [
  {
    id: 'onnx-community/whisper-base.en',
    name: 'Whisper 140MB (English-only)',
    description: 'Good accuracy, English-only',
  },
  {
    id: 'onnx-community/whisper-base',
    name: 'Whisper 140MB (Multilingual)',
    description: 'Good accuracy, 99 languages',
  },
  {
    id: 'onnx-community/whisper-tiny.en',
    name: 'Whisper 40MB (English-only)',
    description: 'Fast, English-only',
  },
  {
    id: 'onnx-community/whisper-tiny',
    name: 'Whisper 40MB (Multilingual)',
    description: 'Fast, supports 99 languages',
  },
  {
    id: 'onnx-community/whisper-small.en',
    name: 'Whisper 240MB (English-only)',
    description: 'Balanced speed/accuracy, English-only',
  },
  {
    id: 'onnx-community/whisper-small',
    name: 'Whisper 240MB (Multilingual)',
    description: 'Balanced, supports 99 languages',
  },
  {
    id: 'onnx-community/whisper-large-v3-turbo',
    name: 'Whisper 1.5GB (Multilingual)',
    description: 'Best accuracy, supports 99 languages',
  },
  {
    id: 'custom',
    name: 'Custom Model',
    description: 'Use a custom Hugging Face model',
    isCustom: true,
  },
];

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelector({ selectedModel, onModelChange, disabled }: ModelSelectorProps) {
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customModelId, setCustomModelId] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  
  const isUsingCustom = !PRESET_MODELS.find(m => m.id === selectedModel && !m.isCustom);
  const currentPreset = PRESET_MODELS.find(m => m.id === selectedModel);
  const displayValue = currentPreset ? selectedModel : 'custom';

  const handleSelectChange = (value: string) => {
    if (value === 'custom') {
      setIsCustomOpen(true);
      setValidationError(null);
      // Don't change model until custom is applied
    } else {
      setIsCustomOpen(false);
      setValidationError(null);
      onModelChange(value);
    }
  };

  const handleCustomModelChange = (value: string) => {
    setCustomModelId(value);
    // Clear error when user starts typing
    if (validationError) {
      setValidationError(null);
    }
  };

  const handleApplyCustomModel = () => {
    const trimmedId = customModelId.trim();
    
    if (!trimmedId) {
      setValidationError('Please enter a model ID');
      return;
    }
    
    if (!isValidModelId(trimmedId)) {
      setValidationError('Invalid format. Model ID must be: username/model-name (e.g., onnx-community/whisper-medium.en)');
      return;
    }
    
    setValidationError(null);
    onModelChange(trimmedId);
    setIsCustomOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <Label htmlFor="modelSelect" className="text-sm font-medium text-foreground whitespace-nowrap">
          Speech Model:
        </Label>
        <Select
          value={displayValue}
          onValueChange={handleSelectChange}
          disabled={disabled}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {PRESET_MODELS.map((model) => {
              const nameMatch = model.name.match(/^(.*?)(\s*\(([^)]+)\))$/);
              const baseName = nameMatch ? nameMatch[1].trim() : model.name;
              const tag = nameMatch ? nameMatch[3] : '';
              return (
                <SelectItem key={model.id} value={model.id}>
                  <div className="flex flex-col items-start">
                    <span className="font-medium">
                      {baseName}
                      {tag && <span className="font-bold text-foreground"> ({tag})</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{model.description}</span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Custom Model Input */}
      <Collapsible open={isCustomOpen || isUsingCustom} onOpenChange={setIsCustomOpen}>
        <CollapsibleContent className="space-y-3">
          <div className="p-4 rounded-lg bg-muted/50 border border-border space-y-3">
            <div className="flex items-start gap-2">
              <Upload className="w-4 h-4 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Custom Hugging Face Model</p>
                <p className="text-xs text-muted-foreground">
                  Enter a model ID from Hugging Face that supports automatic-speech-recognition with ONNX.
                </p>
              </div>
            </div>
            
            <div className="flex gap-2">
              <Input
                placeholder="e.g., onnx-community/whisper-medium.en"
                value={isUsingCustom && !customModelId ? selectedModel : customModelId}
                onChange={(e) => handleCustomModelChange(e.target.value)}
                disabled={disabled}
                className={`flex-1 ${validationError ? 'border-destructive' : ''}`}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleApplyCustomModel}
                disabled={disabled || !customModelId.trim()}
              >
                Apply
              </Button>
            </div>

            {validationError && (
              <div className="flex items-center gap-1 text-destructive text-xs">
                <AlertCircle className="w-3 h-3" />
                <span>{validationError}</span>
              </div>
            )}

            <a
              href="https://huggingface.co/models?pipeline_tag=automatic-speech-recognition&library=transformers.js"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Browse compatible models on Hugging Face
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Show current custom model if using one */}
      {isUsingCustom && !isCustomOpen && (
        <div className="text-xs text-muted-foreground">
          Using custom model: <code className="bg-muted px-1 py-0.5 rounded">{selectedModel}</code>
        </div>
      )}
    </div>
  );
}
