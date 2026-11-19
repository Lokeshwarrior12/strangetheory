import { useState } from 'react';
import { Shuffle } from 'lucide-react';

interface RandomSynapseButtonProps {
  onFire: () => Promise<void> | void;
  label?: string;
  className?: string;
}

export function RandomSynapseButton({
  onFire,
  label = 'Random Experiment',
  className = '',
}: RandomSynapseButtonProps) {
  const [firing, setFiring] = useState(false);

  const handleClick = async () => {
    if (firing) return;
    setFiring(true);
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      await new Promise((r) => setTimeout(r, 340));
    }
    try {
      await onFire();
    } finally {
      setFiring(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={firing}
      className={`group relative inline-flex items-center gap-2 overflow-hidden rounded-lg border px-4 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
        firing
          ? 'border-[#22D3EE] bg-[#22D3EE]/20 text-[#22D3EE] shadow-[0_0_24px_rgba(34,211,238,0.45)]'
          : 'border-slate-700 bg-[#0E1525] text-slate-100 hover:border-[#22D3EE]/70 hover:text-[#22D3EE]'
      } ${className}`}
    >
      {firing && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-[#22D3EE]/35 to-transparent animate-[pulse_350ms_ease-out]"
        />
      )}
      <Shuffle className={`h-3.5 w-3.5 transition-transform duration-300 ${firing ? 'rotate-180 scale-110 text-[#22D3EE]' : 'group-hover:rotate-12'}`} />
      <span>{firing ? 'Firing Synapse...' : label}</span>
    </button>
  );
}
