export default function ProjectLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-6 w-64 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-5 w-20 rounded bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="mb-4 flex gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-7 w-16 rounded bg-slate-100 dark:bg-slate-800/60" />
        ))}
      </div>
      <div className="flex gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="min-w-40 flex-1 rounded border bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-2 h-4 w-24 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-12 rounded bg-slate-100 dark:bg-slate-800/60" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
