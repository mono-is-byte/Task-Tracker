export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-4 h-8 w-48 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded border bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-2 h-4 w-40 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((j) => (
                <div key={j} className="h-8 rounded bg-slate-100 dark:bg-slate-800/60" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
