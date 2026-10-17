import Link from "next/link";

export default function NoAccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-sm rounded-xl bg-white p-6 text-center shadow dark:bg-slate-900">
        <h1 className="text-xl font-bold">No access ⛔</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your role does not allow this action, or you are not a member of this project.
        </p>
        <Link href="/" className="mt-4 inline-block rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white">
          Back to My Work
        </Link>
      </div>
    </div>
  );
}
