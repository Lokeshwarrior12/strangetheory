import type { AppRoute } from '../components/nav/Header';

interface NotFoundPageProps {
  onNavigate: (route: AppRoute) => void;
}

export function NotFoundPage({ onNavigate }: NotFoundPageProps) {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="font-mono text-xs text-[#A78BFA]">404 · Uncharted Coordinate</p>
      <h1 className="mt-3 font-display text-4xl font-semibold text-white">
        This theory hasn&apos;t been written yet
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">
        The page or route you requested does not exist in the StrangeTheory archive.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => onNavigate({ name: 'home' })}
          className="rounded-lg bg-[#22D3EE] px-5 py-2.5 text-sm font-semibold text-slate-950"
        >
          Return Home
        </button>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'explore' })}
          className="rounded-lg border border-slate-700 bg-[#0E1525] px-5 py-2.5 text-sm font-medium text-slate-200"
        >
          Explore Library
        </button>
      </div>
    </div>
  );
}
