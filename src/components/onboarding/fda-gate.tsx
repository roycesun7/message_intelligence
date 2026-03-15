"use client";

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Shield, ExternalLink, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";

interface FdaStatus {
  hasAccess: boolean;
  chatDbConnected: boolean;
  message: string;
}

export function FdaGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<FdaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const result = await invoke<FdaStatus>("check_fda_status");
      setStatus(result);
    } catch (err) {
      setStatus({
        hasAccess: false,
        chatDbConnected: false,
        message: "Could not check access status.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const result = await invoke<FdaStatus>("retry_chat_db_connection");
      setStatus(result);
    } catch (err) {
      setStatus({
        hasAccess: false,
        chatDbConnected: false,
        message: "Retry failed. Please ensure Full Disk Access is granted and try again.",
      });
    } finally {
      setRetrying(false);
    }
  };

  const handleOpenSettings = async () => {
    try {
      const { openSystemSettings } = await import("@/lib/commands");
      await openSystemSettings();
    } catch (err) {
      console.error("Failed to open System Settings:", err);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-[#007AFF]" />
          <p className="text-sm text-zinc-500">Checking access...</p>
        </div>
      </div>
    );
  }

  // FDA granted — render the app
  if (status?.hasAccess) {
    return <>{children}</>;
  }

  // FDA not granted — show onboarding
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 p-8">
      <div className="flex max-w-lg flex-col items-center gap-8 text-center">
        {/* Icon */}
        <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-[#007AFF]/10 ring-1 ring-[#007AFF]/20">
          <Shield className="h-10 w-10 text-[#007AFF]" />
        </div>

        {/* Title */}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Full Disk Access Required
          </h1>
          <p className="text-sm leading-relaxed text-zinc-400">
            Capsule needs permission to read your iMessage database.
            Your data never leaves this device — all processing happens locally.
          </p>
        </div>

        {/* Steps */}
        <div className="w-full rounded-2xl bg-zinc-900/50 ring-1 ring-white/[0.06] p-6">
          <div className="flex flex-col gap-4 text-left">
            <Step number={1}>
              Open <span className="font-medium text-zinc-200">System Settings</span>
            </Step>
            <Step number={2}>
              Go to <span className="font-medium text-zinc-200">Privacy &amp; Security</span> → <span className="font-medium text-zinc-200">Full Disk Access</span>
            </Step>
            <Step number={3}>
              Toggle on <span className="font-medium text-zinc-200">Capsule</span>
            </Step>
            <Step number={4}>
              Come back here and click <span className="font-medium text-zinc-200">Check Again</span>
            </Step>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex w-full flex-col gap-3">
          <button
            onClick={handleOpenSettings}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#007AFF] px-5 py-3 text-sm font-medium text-white transition-all hover:bg-[#007AFF]/90 active:scale-[0.98]"
          >
            <ExternalLink className="h-4 w-4" />
            Open System Settings
          </button>

          <button
            onClick={handleRetry}
            disabled={retrying}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-800 px-5 py-3 text-sm font-medium text-zinc-200 ring-1 ring-white/[0.06] transition-all hover:bg-zinc-700 active:scale-[0.98] disabled:opacity-50"
          >
            {retrying ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Check Again
              </>
            )}
          </button>
        </div>

        {/* Status message */}
        {status?.message && !status.hasAccess && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/5 px-4 py-3 ring-1 ring-amber-500/10">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-xs leading-relaxed text-amber-400/80">{status.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#007AFF]/10 text-xs font-semibold text-[#007AFF]">
        {number}
      </div>
      <p className="text-sm leading-relaxed text-zinc-400 pt-0.5">{children}</p>
    </div>
  );
}
