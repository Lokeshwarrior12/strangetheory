import { useEffect, useState } from 'react';
import { BookOpen, Maximize2, Minimize2, Pause, Play, Square, Volume2 } from 'lucide-react';
import type { ReadingProgress } from '../../lib/types';

export type ReaderSize = 'sm' | 'base' | 'lg';

const SIZE_KEY = 'st_reader_size';

export function useReaderSizePreference(): [ReaderSize, (next: ReaderSize) => void] {
  const [size, setSizeState] = useState<ReaderSize>(() => {
    if (typeof window === 'undefined') return 'base';
    const saved = window.localStorage.getItem(SIZE_KEY);
    return saved === 'sm' || saved === 'lg' ? saved : 'base';
  });

  const setSize = (next: ReaderSize) => {
    setSizeState(next);
    try {
      window.localStorage.setItem(SIZE_KEY, next);
    } catch {
      // ignore storage errors
    }
  };

  return [size, setSize];
}

export function readerProseClass(size: ReaderSize): string {
  if (size === 'sm') return 'editorial-prose text-base leading-relaxed';
  if (size === 'lg') return 'editorial-prose text-xl leading-relaxed';
  return 'editorial-prose text-lg leading-relaxed';
}

interface ReadingControlsProps {
  textSize: ReaderSize;
  onChangeTextSize: (size: ReaderSize) => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  speechText: string;
  resumeProgress?: ReadingProgress | null;
  onResumeSection?: (sectionId: string) => void;
}

export function ReadingControls({
  textSize,
  onChangeTextSize,
  focusMode,
  onToggleFocusMode,
  speechText,
  resumeProgress,
  onResumeSection,
}: ReadingControlsProps) {
  const [speaking, setSpeaking] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [resumeDismissed, setResumeDismissed] = useState(false);

  const hasSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [speechText]);

  const handlePlayPause = () => {
    if (!hasSpeech) return;
    const synth = window.speechSynthesis;
    if (speaking === 'playing') {
      synth.pause();
      setSpeaking('paused');
      return;
    }
    if (speaking === 'paused') {
      synth.resume();
      setSpeaking('playing');
      return;
    }
    synth.cancel();
    const clean = speechText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 0.98;
    utter.onend = () => setSpeaking('idle');
    utter.onerror = () => setSpeaking('idle');
    synth.speak(utter);
    setSpeaking('playing');
  };

  const handleStop = () => {
    if (!hasSpeech) return;
    window.speechSynthesis.cancel();
    setSpeaking('idle');
  };

  return (
    <div className="space-y-3">
      {resumeProgress && resumeProgress.progress_pct > 5 && !resumeDismissed && onResumeSection && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#22D3EE]/35 bg-[#131D33] px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2 text-slate-200">
            <BookOpen className="h-4 w-4 text-[#22D3EE]" />
            <span>
              Resume where you left off ({Math.min(100, Math.round(resumeProgress.progress_pct))}% read)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onResumeSection(resumeProgress.last_section || 'premise');
                setResumeDismissed(true);
              }}
              className="rounded-md bg-[#22D3EE] px-3 py-1 font-semibold text-slate-950 hover:bg-cyan-300"
            >
              Jump to section
            </button>
            <button
              type="button"
              onClick={() => setResumeDismissed(true)}
              className="text-slate-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#0E1525] px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-slate-400">Text</span>
          <div className="inline-flex rounded-lg border border-slate-800 bg-[#070B14] p-0.5" role="group" aria-label="Text size">
            {([
              { id: 'sm', label: 'A-' },
              { id: 'base', label: 'A' },
              { id: 'lg', label: 'A+' },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeTextSize(opt.id)}
                aria-pressed={textSize === opt.id}
                className={`rounded-md px-2.5 py-1 font-mono font-semibold transition-colors ${
                  textSize === opt.id ? 'bg-[#22D3EE] text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasSpeech && (
            <div className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-[#070B14] px-2 py-1">
              <Volume2 className="h-3.5 w-3.5 text-[#A78BFA] mr-1" />
              <button
                type="button"
                onClick={handlePlayPause}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-slate-200 hover:text-[#22D3EE]"
              >
                {speaking === 'playing' ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                <span>{speaking === 'playing' ? 'Pause' : speaking === 'paused' ? 'Resume' : 'Read aloud'}</span>
              </button>
              {speaking !== 'idle' && (
                <button
                  type="button"
                  onClick={handleStop}
                  aria-label="Stop read-aloud"
                  className="rounded p-1 text-slate-400 hover:text-rose-300"
                >
                  <Square className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onToggleFocusMode}
            aria-pressed={focusMode}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-semibold transition-colors ${
              focusMode
                ? 'border-[#22D3EE] bg-[#22D3EE] text-slate-950'
                : 'border-slate-700 bg-[#070B14] text-slate-200 hover:border-[#22D3EE]'
            }`}
          >
            {focusMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {focusMode ? 'Exit Focus' : 'Focus Mode'}
          </button>
        </div>
      </div>
    </div>
  );
}
