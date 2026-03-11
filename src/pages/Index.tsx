import { AudioWaveform, Shield, Zap } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TranscriptionTab } from '@/components/TranscriptionTab';
import { ReferenceScriptTab } from '@/components/ReferenceScriptTab';

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <AudioWaveform className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">SRT Generator</h1>
              <p className="text-xs text-muted-foreground">Offline Audio Transcription</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Features Banner */}
        <div className="flex flex-wrap justify-center gap-6 mb-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="w-4 h-4 text-success" />
            <span>100% Offline</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap className="w-4 h-4 text-primary" />
            <span>Browser-Based AI</span>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="transcription" className="w-full">
          <TabsList className="w-full mb-6">
            <TabsTrigger value="transcription" className="flex-1">
              Audio Transcription
            </TabsTrigger>
            <TabsTrigger value="reference" className="flex-1">
              Reference Script
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transcription">
            <TranscriptionTab />
          </TabsContent>

          <TabsContent value="reference">
            <ReferenceScriptTab />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-auto">
        <div className="container mx-auto px-4 py-4">
          <p className="text-xs text-muted-foreground text-center">
            All transcription is performed locally using WebAssembly-based speech recognition.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
