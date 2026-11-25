import { useState } from 'react';
import { ArrowRight, Brain, Check, Sparkles, X } from 'lucide-react';
import { api, ApiError, type CategoryWithCount } from '../../lib/api';
import { APP_NAME } from '../../lib/config';
import { useToast } from '../ui/ToastContext';
import type { Profile } from '../../lib/types';

interface OnboardingModalProps {
  open: boolean;
  categories: CategoryWithCount[];
  onClose: () => void;
  onCompleted: (user: Profile) => void;
}

export function OnboardingModal({ open, categories, onClose, onCompleted }: OnboardingModalProps) {
  const { pushToast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [weeklyGoal, setWeeklyGoal] = useState<1 | 3 | 5>(3);
  const [weeklyDigest, setWeeklyDigest] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const toggleRegion = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return [prev[1], prev[2], id];
      return [...prev, id];
    });
  };

  const finishOnboarding = async (skip = false) => {
    setBusy(true);
    try {
      const res = await api.submitOnboarding({
        favorite_category_ids: skip ? [] : selectedIds,
        reading_goal_per_week: weeklyGoal,
        weekly_digest_enabled: skip ? false : weeklyDigest,
      });
      onCompleted(res.user);
      if (!skip) {
        pushToast('Your Observatory preferences are saved.', 'success');
      }
      onClose();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to save preferences.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Welcome to ${APP_NAME}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-[#0E1525] p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-xs text-[#22D3EE]">
            <Brain className="h-4 w-4" />
            <span>Step {step} of 3 · Quick Calibration</span>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => finishOnboarding(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-white"
          >
            Skip setup
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {step === 1 && (
          <div className="mt-5">
            <h2 className="font-display text-2xl font-semibold text-white">
              Choose up to 3 brain regions to follow
            </h2>
            <p className="mt-1.5 text-sm text-slate-400">
              We&apos;ll shape your &ldquo;For You&rdquo; shelf around these domains. You can change them anytime.
            </p>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
              {categories.map((cat) => {
                const active = selectedIds.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleRegion(cat.id)}
                    className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-[#22D3EE] bg-[#22D3EE]/15 text-white'
                        : 'border-slate-800 bg-[#070B14] text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: cat.color }} />
                        <span className="text-xs font-semibold">{cat.name}</span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">{cat.brain_region}</p>
                    </div>
                    {active && <Check className="h-4 w-4 text-[#22D3EE] shrink-0" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-6 flex items-center justify-between">
              <span className="font-mono text-xs text-slate-400">{selectedIds.length} of 3 selected</span>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                Continue
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-5">
            <h2 className="font-display text-2xl font-semibold text-white">Pick a calm weekly reading goal</h2>
            <p className="mt-1.5 text-sm text-slate-400">
              Your My Brain page tracks gentle weekly momentum without noisy streaks or pushy alerts.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {([1, 3, 5] as const).map((goal) => (
                <button
                  key={goal}
                  type="button"
                  onClick={() => setWeeklyGoal(goal)}
                  className={`rounded-xl border p-4 text-center transition-colors ${
                    weeklyGoal === goal
                      ? 'border-[#22D3EE] bg-[#22D3EE]/15 text-white'
                      : 'border-slate-800 bg-[#070B14] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <span className="block font-mono text-2xl font-semibold tabular-nums text-[#22D3EE]">{goal}</span>
                  <span className="mt-1 block text-xs text-slate-300">
                    {goal === 1 ? '1 / week · Light' : goal === 3 ? '3 / week · Steady' : '5 / week · Deep'}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                Continue
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-5">
            <h2 className="font-display text-2xl font-semibold text-white">How {APP_NAME} protects attention</h2>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
              <div className="rounded-xl border border-slate-800 bg-[#070B14] p-4">
                <p className="font-semibold text-white">Focus Limits on every screen</p>
                <p className="mt-1 text-xs text-slate-400">
                  Feeds stay curated (no infinite doomscroll), brain-region filters cap at 2 at once, and discussions separate into Ripples, Stress-Tests, and Branches.
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#070B14] p-4">
                <p className="font-semibold text-white">Spoiler-protected Riddles</p>
                <p className="mt-1 text-xs text-slate-400">
                  Community answers stay hidden behind a curtain until you submit a guess, and official answers stay sealed on the server until reveal.
                </p>
              </div>
              <label className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-[#070B14] p-4 cursor-pointer text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={weeklyDigest}
                  onChange={(e) => setWeeklyDigest(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <strong className="text-white">Subscribe to The Weekly Synapse</strong> — max 1 calm email per week with 1 featured experiment, 1 riddle, and your top stat.
                </span>
              </label>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white"
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => finishOnboarding(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {busy ? 'Saving...' : 'Enter Observatory'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
