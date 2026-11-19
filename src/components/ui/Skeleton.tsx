export function PostCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-[#0E1525] p-6 animate-pulse">
      <div className="mb-4 aspect-[16/10] w-full rounded-lg bg-[#131D33]" />
      <div className="mb-3 h-3 w-40 rounded bg-[#131D33]" />
      <div className="mb-2 h-6 w-11/12 rounded bg-[#131D33]" />
      <div className="mb-4 h-4 w-3/4 rounded bg-[#131D33]" />
      <div className="h-3 w-full rounded bg-[#131D33]" />
      <div className="mt-2 h-3 w-2/3 rounded bg-[#131D33]" />
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-14 animate-pulse">
      <div className="h-4 w-48 rounded bg-[#131D33]" />
      <div className="mt-4 h-10 w-5/6 rounded bg-[#131D33]" />
      <div className="mt-4 h-5 w-full rounded bg-[#131D33]" />
      <div className="mt-8 aspect-[16/9] w-full rounded-2xl bg-[#0E1525]" />
      <div className="mt-8 space-y-3">
        <div className="h-4 w-full rounded bg-[#131D33]" />
        <div className="h-4 w-11/12 rounded bg-[#131D33]" />
        <div className="h-4 w-4/5 rounded bg-[#131D33]" />
      </div>
    </div>
  );
}
