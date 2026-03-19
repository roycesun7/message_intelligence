"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-[#ECEEF2] dark:bg-zinc-950 text-[#1B2432] dark:text-zinc-100 flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center text-center max-w-md p-8">
          <div className="text-4xl mb-4">:(</div>
          <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
          <p className="text-sm text-[#4E5D6E] dark:text-zinc-400 mb-6">
            {error.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg bg-[#3B82C4] text-white text-sm font-medium hover:bg-[#3B82C4]/90 transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
