import { Award, Copy, Download } from 'lucide-react';
import { calculateRiddleSolvePoints } from '../../lib/scoring';
import { downloadRiddleResultCardPng } from '../../lib/shareCanvas';
import { useToast } from '../ui/ToastContext';
import type { EnrichedPost } from '../../lib/types';

interface RiddleResultCardProps {
  post: EnrichedPost;
}

export function RiddleResultCard({ post }: RiddleResultCardProps) {
  const { pushToast } = useToast();
  const riddle = post.riddle;
  const attempt = post.riddle_attempt;

  if (!riddle || !attempt?.solved) return null;

  const hintsUsed = attempt.hints_used || 0;
  const points =
    attempt.points_awarded && attempt.points_awarded > 0
      ? attempt.points_awarded
      : calculateRiddleSolvePoints(riddle.difficulty, hintsUsed, false);
  const accentColor = post.categories[0]?.color || '#A78BFA';
  const shareUrl = `${window.location.origin}/riddle/${post.slug}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        `I solved "${post.title}" (${riddle.difficulty}) on StrangeTheory with ${hintsUsed} hints for +${points} Synapse! ${shareUrl}`
      );
      pushToast('Result link copied to clipboard.', 'success');
    } catch {
      pushToast(`Share link: ${shareUrl}`, 'info');
    }
  };

  const handleDownload = () => {
    downloadRiddleResultCardPng({
      slug: post.slug,
      title: post.title,
      difficulty: riddle.difficulty,
      riddleType: riddle.riddle_type,
      hintsUsed,
      pointsAwarded: points,
      accentColor,
    });
    pushToast('Spoiler-free result card PNG downloaded.', 'success');
  };

  return (
    <section
      data-testid="riddle-result-card"
      className="rounded-2xl border border-emerald-500/40 bg-[#0E1B1E] p-6 shadow-lg"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Award className="h-5 w-5 text-emerald-400 shrink-0" />
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-emerald-300">Riddle Result Card</p>
            <h3 className="font-display text-xl font-semibold text-white">Solved without spoilers</h3>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-[#070B14] px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:border-emerald-300"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy link
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-400 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-300"
          >
            <Download className="h-3.5 w-3.5" />
            Download image
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-800 bg-[#070B14] p-3.5">
          <p className="font-mono text-[11px] text-slate-400">Difficulty</p>
          <p className="mt-1 font-display text-lg font-semibold text-[#A78BFA]">{riddle.difficulty}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#070B14] p-3.5">
          <p className="font-mono text-[11px] text-slate-400">Hints used</p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-amber-300">{hintsUsed}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#070B14] p-3.5">
          <p className="font-mono text-[11px] text-slate-400">Points</p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-[#22D3EE]">+{points} Syn</p>
        </div>
      </div>
    </section>
  );
}
