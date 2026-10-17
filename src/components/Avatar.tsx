"use client";

/**
 * Change request Phase 4: the app-wide avatar. Shows the uploaded picture when
 * present (jpg/jpeg only, admin/PM or self-managed) and falls back to an
 * initials circle tinted from the name hash.
 */
export default function Avatar({
  name,
  url,
  size = 24,
  className = "",
}: {
  name: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words.slice(0, 2).map((w) => w[0] ?? "").join("") || "?").toUpperCase();
  const palette = [
    "bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-sky-500",
    "bg-indigo-500", "bg-violet-500", "bg-fuchsia-500", "bg-teal-500",
  ];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const color = palette[hash % palette.length];
  const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) };

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={name} title={name} style={style}
        className={`shrink-0 rounded-full object-cover ${className}`} />
    );
  }
  return (
    <span aria-hidden title={name} style={style}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white ${color} ${className}`}>
      {initials}
    </span>
  );
}
