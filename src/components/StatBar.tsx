export default function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="w-40 shrink-0 truncate">{label}</span>
      <div className="h-3 flex-1 rounded bg-line">
        <div className="h-3 rounded" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: color }} />
      </div>
      <span className="w-16 text-right font-mono">{value}</span>
    </div>
  );
}
