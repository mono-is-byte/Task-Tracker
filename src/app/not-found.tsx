import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-sm text-muted">The page you are looking for does not exist.</p>
      <Link href="/" className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white">Go home</Link>
    </div>
  );
}
