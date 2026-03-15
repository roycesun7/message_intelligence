"use client";

import { useState, useEffect } from "react";
import { Settings, RotateCcw, Trash2, Play, Bug, ChevronDown, ChevronRight, Loader2, Cpu, CheckCircle, AlertCircle } from "lucide-react";
import { useEmbeddingStatus } from "@/hooks/use-search";
import {
  setIndexTarget,
  runPipeline,
  rebuildSearchIndex,
  getDataDir,
  clearAllEmbeddings,
  getDebugEmbeddings,
  getModelDiagnostics,
  type DebugEmbeddingItem,
} from "@/lib/commands";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import type { EmbeddingProgress, ModelDiagnostics } from "@/types";

const STEP_LABELS: Record<string, string> = {
  ort_runtime: "ORT Runtime",
  find_models: "Find Models",
  check_files: "Check Files",
  load_text_encoder: "Text Encoder",
  load_vision_encoder: "Vision Encoder",
  load_tokenizer: "Tokenizer",
};

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case "success": return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "error": return <AlertCircle className="h-4 w-4 text-red-500" />;
    case "running": return <Loader2 className="h-4 w-4 text-[#007AFF] animate-spin" />;
    default: return <div className="h-4 w-4 rounded-full bg-zinc-300 dark:bg-zinc-600" />;
  }
}

function DebugSection({ sourceType, label }: { sourceType: string; label: string }) {
  const [items, setItems] = useState<DebugEmbeddingItem[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (!expanded && items === null) {
      setLoading(true);
      try {
        const data = await getDebugEmbeddings(sourceType, 50);
        setItems(data);
      } catch (err) {
        console.error(`Failed to load debug ${sourceType}:`, err);
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div>
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 w-full text-left text-sm text-[#4B6382] dark:text-zinc-400 hover:text-[#071739] dark:hover:text-zinc-200 transition-colors cursor-pointer py-1"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {label}
        {items !== null && <span className="text-xs text-[#A4B5C4] dark:text-zinc-600">({items.length})</span>}
      </button>
      {expanded && (
        <div className="ml-5 mt-1 space-y-1 max-h-64 overflow-y-auto">
          {loading && <p className="text-xs text-[#A4B5C4] dark:text-zinc-500">Loading...</p>}
          {items && items.length === 0 && (
            <p className="text-xs text-[#A4B5C4] dark:text-zinc-500">No items found.</p>
          )}
          {items?.map((item, i) => (
            <div
              key={`${item.sourceType}-${item.sourceId}-${i}`}
              className="rounded-md bg-[#CDD5DB]/15 dark:bg-zinc-800/40 px-2.5 py-1.5 text-xs font-mono"
            >
              <div className="flex justify-between gap-2">
                <span className="text-[#4B6382] dark:text-zinc-400">
                  #{item.sourceId} · chat {item.chatId}
                </span>
                <span className="text-[#A4B5C4] dark:text-zinc-600 shrink-0">
                  {item.embeddedAt}
                </span>
              </div>
              {item.text && (
                <p className="mt-0.5 text-[#071739] dark:text-zinc-300 line-clamp-2 break-all select-text">
                  {item.text}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { data: status } = useEmbeddingStatus();
  const queryClient = useQueryClient();
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState<EmbeddingProgress | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ModelDiagnostics | null>(null);

  const pipelineRunning = pipelineProgress !== null && pipelineProgress.phase !== "done";

  useEffect(() => {
    getDataDir().then(setDataDir).catch(() => {});
  }, []);

  // Listen to pipeline progress events
  useEffect(() => {
    let cancelled = false;
    const unlisten = listen<EmbeddingProgress>("embedding-progress", (event) => {
      if (!cancelled) {
        setPipelineProgress(event.payload);
        if (event.payload.phase === "done") {
          queryClient.invalidateQueries({ queryKey: ["embeddingStatus"] });
        }
      }
    });
    return () => {
      cancelled = true;
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [queryClient]);

  // Fetch model diagnostics on mount and poll while loading
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchDiagnostics = async () => {
      try {
        const data = await getModelDiagnostics();
        if (!cancelled) {
          setDiagnostics(data);
          if (data.overall === "loading") {
            timer = setTimeout(fetchDiagnostics, 2000);
          }
        }
      } catch {
        // Ignore errors
      }
    };

    fetchDiagnostics();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Listen to model-load-progress events
  useEffect(() => {
    let cancelled = false;
    const unlisten = listen<ModelDiagnostics>("model-load-progress", (event) => {
      if (!cancelled) {
        setDiagnostics(event.payload);
      }
    });
    return () => {
      cancelled = true;
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const currentTarget = status?.indexTarget ?? 500;
  const totalMessages = status?.totalMessages ?? 0;
  const totalEmbedded = status?.totalEmbedded ?? 0;
  const displayTarget = sliderValue ?? currentTarget;

  const handleSliderChange = (value: number) => {
    setSliderValue(value);
  };

  const commitSliderValue = async (value: number | null) => {
    if (value === null) return;
    try {
      await setIndexTarget(value);
      queryClient.invalidateQueries({ queryKey: ["embeddingStatus"] });
    } catch (err) {
      console.error("Failed to set index target:", err);
    }
  };

  const handleStartIndexing = async () => {
    // Save the slider value first if changed
    if (sliderValue !== null) {
      await commitSliderValue(sliderValue);
    }
    try {
      await runPipeline();
    } catch {
      // Pipeline may already be running — that's fine, progress events will update the UI
    }
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await rebuildSearchIndex();
      queryClient.invalidateQueries({ queryKey: ["embeddingStatus"] });
    } catch (err) {
      console.error("Failed to rebuild index:", err);
    } finally {
      setRebuilding(false);
    }
  };

  const handleClearEmbeddings = async () => {
    try {
      await clearAllEmbeddings();
      queryClient.invalidateQueries({ queryKey: ["embeddingStatus"] });
    } catch (err) {
      console.error("Failed to clear embeddings:", err);
    }
  };

  const progress = displayTarget > 0 ? Math.min(100, (totalEmbedded / displayTarget) * 100) : 0;
  const needsMoreIndexing = totalEmbedded < displayTarget;

  return (
    <div className="flex flex-1 flex-col bg-[#F0EDE8] dark:bg-zinc-950 p-6 overflow-y-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-[#071739] dark:text-white">Settings</h1>
        <p className="mt-1 text-sm text-[#4B6382] dark:text-zinc-400">
          Configure search indexing and other preferences
        </p>
      </div>

      <div className="max-w-lg mx-auto w-full space-y-8">
        {/* Model Status Section */}
        <div className="bg-white/80 dark:bg-[#2C2C2E] rounded-2xl p-6 border border-[#CDD5DB]/40 dark:border-transparent">
          <div className="flex items-center gap-3 mb-4">
            <Cpu className="h-5 w-5 text-[#4B6382] dark:text-zinc-400" />
            <h2 className="text-lg font-semibold text-[#071739] dark:text-white">Model Status</h2>
          </div>

          {/* Overall status banner */}
          <div className="mb-4">
            {(!diagnostics || diagnostics.overall === "pending") && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-sm text-[#4B6382] dark:text-zinc-400">
                <div className="h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                Waiting...
              </span>
            )}
            {diagnostics?.overall === "loading" && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#007AFF]/10 text-sm text-[#007AFF]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading models...
              </span>
            )}
            {diagnostics?.overall === "ready" && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 text-sm text-green-600 dark:text-green-400">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                Models ready
              </span>
            )}
            {diagnostics?.overall === "error" && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 text-sm text-red-600 dark:text-red-400">
                <div className="h-2 w-2 rounded-full bg-red-500" />
                Models failed to load
              </span>
            )}
          </div>

          {/* Step list */}
          {diagnostics && diagnostics.steps.length > 0 && (
            <div className="space-y-2 mb-4">
              {diagnostics.steps.map((step) => (
                <div key={step.name} className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0">
                    <StepIcon status={step.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-[#071739] dark:text-white">
                        {STEP_LABELS[step.name] ?? step.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </span>
                      {step.durationMs !== null && (
                        <span className="text-xs text-[#A4B5C4] dark:text-zinc-500 shrink-0">
                          {step.durationMs}ms
                        </span>
                      )}
                    </div>
                    {step.message && (
                      <p className="text-xs text-[#4B6382] dark:text-zinc-400 mt-0.5 break-all">
                        {step.message}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Path info */}
          {diagnostics && (diagnostics.ortDylibPath || diagnostics.modelsDir) && (
            <div className="rounded-lg bg-[#CDD5DB]/20 dark:bg-zinc-800/50 p-3 space-y-1.5 text-xs font-mono">
              {diagnostics.ortDylibPath && (
                <div>
                  <span className="text-[#4B6382] dark:text-zinc-400">ORT dylib path</span>
                  <p className="mt-0.5 text-[#071739] dark:text-zinc-300 break-all select-text">{diagnostics.ortDylibPath}</p>
                </div>
              )}
              {diagnostics.modelsDir && (
                <div>
                  <span className="text-[#4B6382] dark:text-zinc-400">Models directory</span>
                  <p className="mt-0.5 text-[#071739] dark:text-zinc-300 break-all select-text">{diagnostics.modelsDir}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search Index Section */}
        <div className="bg-white/80 dark:bg-[#2C2C2E] rounded-2xl p-6 border border-[#CDD5DB]/40 dark:border-transparent">
          <div className="flex items-center gap-3 mb-4">
            <Settings className="h-5 w-5 text-[#4B6382] dark:text-zinc-400" />
            <h2 className="text-lg font-semibold text-[#071739] dark:text-white">Search Index</h2>
          </div>

          {/* Status */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-[#4B6382] dark:text-zinc-400">
                {status?.modelsLoaded ? (pipelineRunning ? "Indexing..." : "Ready") : "Models not loaded — see above"}
              </span>
              <span className="text-sm text-[#A4B5C4] dark:text-zinc-500">
                {totalEmbedded.toLocaleString()} / {displayTarget.toLocaleString()} messages
              </span>
            </div>
            <div className="h-2 bg-[#CDD5DB]/40 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#007AFF] rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Embedding breakdown */}
          {status && (
            <div className="mb-6 rounded-lg bg-[#CDD5DB]/20 dark:bg-zinc-800/50 p-3 space-y-1.5 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-[#4B6382] dark:text-zinc-400">Total indexed</span>
                <span className="text-[#071739] dark:text-zinc-200 font-medium">{totalEmbedded.toLocaleString()} embeddings</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#4B6382] dark:text-zinc-400">├ Conversation chunks</span>
                <span className="text-[#071739] dark:text-zinc-200">{status.chunkCount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#4B6382] dark:text-zinc-400">├ Individual messages</span>
                <span className="text-[#071739] dark:text-zinc-200">{status.messageCount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#4B6382] dark:text-zinc-400">└ Images / stickers</span>
                <span className="text-[#071739] dark:text-zinc-200">{status.attachmentCount.toLocaleString()}</span>
              </div>
              <div className="border-t border-[#CDD5DB]/30 dark:border-zinc-700 pt-1.5 flex justify-between">
                <span className="text-[#4B6382] dark:text-zinc-400">Target</span>
                <span className="text-[#071739] dark:text-zinc-200 font-medium">{displayTarget.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#4B6382] dark:text-zinc-400">Total messages in DB</span>
                <span className="text-[#071739] dark:text-zinc-200">{totalMessages.toLocaleString()}</span>
              </div>
              {dataDir && (
                <div className="border-t border-[#CDD5DB]/30 dark:border-zinc-700 pt-1.5">
                  <span className="text-[#4B6382] dark:text-zinc-400">Storage path</span>
                  <p className="mt-0.5 text-[#071739] dark:text-zinc-300 break-all select-text">{dataDir}</p>
                </div>
              )}
            </div>
          )}

          {/* Slider */}
          <div className="mb-6">
            <label className="text-sm text-[#4B6382] dark:text-zinc-400 mb-2 block">
              Index Coverage
            </label>
            <input
              type="range"
              min={500}
              max={totalMessages || 10000}
              step={500}
              value={displayTarget}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              onPointerUp={() => commitSliderValue(sliderValue)}
              className="w-full accent-[#007AFF]"
            />
            <div className="flex justify-between mt-1">
              <span className="text-xs text-[#A4B5C4] dark:text-zinc-600">500</span>
              <span className="text-xs text-[#A4B5C4] dark:text-zinc-600">{totalMessages.toLocaleString()}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {pipelineRunning ? (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#007AFF]/15 text-[#007AFF] text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {pipelineProgress.phase === "chunking" ? "Analyzing" : "Indexing"}...
                  {pipelineProgress.total > 0 && ` ${Math.round((pipelineProgress.processed / pipelineProgress.total) * 100)}%`}
                </span>
              </div>
            ) : (
              <button
                onClick={handleStartIndexing}
                disabled={!needsMoreIndexing || !status?.modelsLoaded}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#007AFF] text-white hover:bg-[#007AFF]/90 transition-colors text-sm disabled:opacity-40 cursor-pointer"
              >
                <Play className="h-4 w-4" />
                {needsMoreIndexing ? "Start Indexing" : "Up to Date"}
              </button>
            )}

            <button
              onClick={handleRebuild}
              disabled={rebuilding}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#CDD5DB]/30 dark:bg-zinc-700 text-[#4B6382] dark:text-zinc-300 hover:bg-[#CDD5DB]/50 dark:hover:bg-zinc-600 transition-colors text-sm disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className={`h-4 w-4 ${rebuilding ? "animate-spin" : ""}`} />
              {rebuilding ? "Rebuilding..." : "Rebuild Index"}
            </button>

            <button
              onClick={handleClearEmbeddings}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 dark:hover:bg-red-500/20 transition-colors text-sm cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
              Delete Embeddings
            </button>
          </div>
        </div>

        {/* Debug Section */}
        <div className="bg-white/80 dark:bg-[#2C2C2E] rounded-2xl p-6 border border-[#CDD5DB]/40 dark:border-transparent">
          <button
            onClick={() => setDebugMode(!debugMode)}
            className="flex items-center gap-3 w-full text-left cursor-pointer"
          >
            <Bug className="h-5 w-5 text-[#4B6382] dark:text-zinc-400" />
            <h2 className="text-lg font-semibold text-[#071739] dark:text-white">Debug Inspector</h2>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${debugMode ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-[#CDD5DB]/30 dark:bg-zinc-700 text-[#A4B5C4] dark:text-zinc-500"}`}>
              {debugMode ? "ON" : "OFF"}
            </span>
          </button>

          {debugMode && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-[#A4B5C4] dark:text-zinc-500 mb-3">
                Inspect what has been embedded. Click each section to expand and view up to 50 most recent items.
              </p>
              <DebugSection sourceType="chunk" label="Conversation Chunks" />
              <DebugSection sourceType="message" label="Individual Messages" />
              <DebugSection sourceType="attachment" label="Images / Stickers" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
