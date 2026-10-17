import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-6xl font-black text-indigo-600 dark:text-indigo-400">404</p>
      <h1 className="text-xl font-bold">Page not found</h1>
      <p className="max-w-md text-sm text-slate-500">
        The page you are looking for does not exist, was moved, or you do not have access to it.
      </p>
      <div className="mt-2 flex gap-2">
        <Link href="/" className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500">
          Go to My Work
        </Link>
        <Link href="/login" className="rounded border px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
          Login
        </Link>
      </div>
    </div>
  );
}
