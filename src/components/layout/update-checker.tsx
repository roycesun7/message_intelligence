"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface UpdateInfo {
  version: string;
  available: boolean;
}

export function UpdateChecker() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkForUpdate() {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const result = await check();
        if (!cancelled && result) {
          setUpdate({ version: result.version, available: true });
        }
      } catch {
        // Updater not configured or no update available — silent
      }
    }
    // Check after a short delay so we don't block startup
    const timer = setTimeout(checkForUpdate, 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  if (!update?.available || dismissed) return null;

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const result = await check();
      if (result) {
        await result.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      }
    } catch {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-2xl bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border border-[#D1D5DB]/40 dark:border-white/[0.08] shadow-lg dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] px-5 py-3.5 animate-in slide-in-from-bottom-4">
      <div className="flex-1">
        <p className="text-sm font-medium text-[#1B2432] dark:text-zinc-200">
          Capsule {update.version} is available
        </p>
        <p className="text-xs text-[#4E5D6E] dark:text-zinc-500 mt-0.5">
          {installing ? "Downloading update..." : "Restart to update."}
        </p>
      </div>
      <button
        onClick={handleInstall}
        disabled={installing}
        className="flex items-center gap-1.5 rounded-xl bg-[#1B2432] dark:bg-[#007AFF] px-4 py-2 text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {installing ? "Installing..." : "Update"}
      </button>
      {!installing && (
        <button
          onClick={() => setDismissed(true)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#94A3B3] dark:text-zinc-500 hover:bg-[#1B2432]/5 dark:hover:bg-white/5"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
