import { useEffect, useState } from 'react';

interface NeuronProgressBarProps {
  accentColor?: string;
}

export function NeuronProgressBar({ accentColor = '#22D3EE' }: NeuronProgressBarProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const update = () => {
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop;
      const total = Math.max(1, doc.scrollHeight - window.innerHeight);
      const pct = Math.max(0, Math.min(100, (scrollTop / total) * 100));
      setProgress(pct);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <div
      aria-label="Reading progress"
      role="progressbar"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="sticky top-[65px] z-30 h-3 w-full bg-[#070B14]/90 border-b border-slate-800/70"
    >
      <div className="relative h-full w-full overflow-hidden">
        {/* Axon track */}
        <div className="absolute top-1/2 left-0 right-0 h-[1.5px] -translate-y-1/2 bg-slate-800" />
        {/* Firing signal line */}
        <div
          className="absolute top-1/2 left-0 h-[2px] -translate-y-1/2 transition-[width] duration-100"
          style={{
            width: `${progress}%`,
            background: `linear-gradient(90deg, #A78BFA 0%, ${accentColor} 100%)`,
          }}
        />
        {/* Traveling synaptic soma */}
        <div
          className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 -translate-x-1/2 rounded-full transition-[left] duration-100"
          style={{
            left: `${progress}%`,
            backgroundColor: accentColor,
            boxShadow: `0 0 10px ${accentColor}`,
          }}
        />
      </div>
    </div>
  );
}
