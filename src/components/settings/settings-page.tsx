"use client";

import { useState, useEffect } from "react";
import { Settings, RotateCcw, Trash2, Play, Bug, ChevronDown, ChevronRight, Loader2, Cpu, CheckCircle, AlertCircle, FolderOpen, RefreshCw, Download } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useEmbeddingStatus } from "@/hooks/use-search";
import {
  setIndexTarget,
  runPipeline,
  rebuildSearchIndex,
  getDataDir,
  clearAllEmbeddings,
  getDebugEmbeddings,
  getModelDiagnostics,
  getModelsDir,
  openModelsDir,
  reloadModels,
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
  const [modelsDir, setModelsDir] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    getDataDir().then(setDataDir).catch(() => {});
    getModelsDir().then(setModelsDir).catch(() => {});
  }, []);

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
    return () => { cancelled = true; unlisten.then((fn) => fn()).catch(() => {}); };
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fetchDiagnostics = async () => {
      try {
        const data = await getModelDiagnostics();
        if (!cancelled) {
          setDiagnostics(data);
          if (data.overall === "loading") timer = setTimeout(fetchDiagnostics, 2000);
        }
      } catch { /* ignore */ }
    };
    fetchDiagnostics();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisten = listen<ModelDiagnostics>("model-load-progress", (event) => {
      if (!cancelled) setDiagnostics(event.payload);
    });
    return () => { cancelled = true; unlisten.then((fn) => fn()).catch(() => {}); };
  }, []);

  return (
    <div className="flex flex-1 flex-col bg-[#ECEEF2] dark:bg-zinc-950 p-6 overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-[#071739] dark:text-white">Settings</h1>
        <p className="mt-1 text-sm text-[#4B6382] dark:text-zinc-400">
          Preferences and advanced settings
        </p>
      </div>

      <div className="max-w-3xl mx-auto w-full space-y-8">
        {/* Tutorial Section — always visible */}
        <div className="bg-white/80 dark:bg-[#2C2C2E] rounded-2xl p-6 border border-[#CDD5DB]/40 dark:border-transparent">
          <div className="flex items-center gap-3 mb-2">
            <Play className="h-5 w-5 text-[#4B6382] dark:text-zinc-400" />
            <h2 className="text-lg font-semibold text-[#071739] dark:text-white">Tutorial</h2>
          </div>
          <p className="text-sm text-[#4B6382] dark:text-zinc-400 mb-4">
            Replay the guided walkthrough of Capsule.
          </p>
          <ReplayTutorialButton />
        </div>

        {/* Semantic Search Settings — collapsed by default */}
        <AdvancedSearchSettings
          status={status}
          queryClient={queryClient}
          sliderValue={sliderValue}
          setSliderValue={setSliderValue}
          rebuilding={rebuilding}
          setRebuilding={setRebuilding}
          pipelineProgress={pipelineProgress}
          dataDir={dataDir}
          debugMode={debugMode}
          setDebugMode={setDebugMode}
          diagnostics={diagnostics}
          modelsDir={modelsDir}
          reloading={reloading}
          setReloading={setReloading}
        />
      </div>
    </div>
  );
}

function AdvancedSearchSettings({
  status, queryClient, sliderValue, setSliderValue,
  rebuilding, setRebuilding, pipelineProgress,
  dataDir, debugMode, setDebugMode, diagnostics,
  modelsDir, reloading, setReloading,
}: {
  status: ReturnType<typeof useEmbeddingStatus>["data"];
  queryClient: ReturnType<typeof useQueryClient>;
  sliderValue: number | null;
  setSliderValue: (v: number | null) => void;
  rebuilding: boolean;
  setRebuilding: (v: boolean) => void;
  pipelineProgress: EmbeddingProgress | null;
  dataDir: string | null;
  debugMode: boolean;
  setDebugMode: (v: boolean) => void;
  diagnostics: ModelDiagnostics | null;
  modelsDir: string | null;
  reloading: boolean;
  setReloading: (v: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const pipelineRunning = pipelineProgress !== null && pipelineProgress.phase !== "done";
  const currentTarget = status?.indexTarget ?? 500;
  const totalMessages = status?.totalMessages ?? 0;
  const totalEmbedded = status?.totalEmbedded ?? 0;
  const displayTarget = sliderValue ?? currentTarget;
  const progress = displayTarget > 0 ? Math.min(100, (totalEmbedded / displayTarget) * 100) : 0;
  const needsMoreIndexing = totalEmbedded < displayTarget;

  const handleSliderChange = (value: number) => setSliderValue(value);

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
    if (sliderValue !== null) await commitSliderValue(sliderValue);
    try { await runPipeline(); } catch { /* may already be running */ }
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await rebuildSearchIndex();
      queryClient.invalidateQueries({ queryKey: ["embeddingStatus"] });
    } catch (err) { console.error("Failed to rebuild index:", err); }
    finally { setRebuilding(false); }
  };

  const handleClearEmbeddings = async () => {
    try {
      await clearAllEmbeddings();
      queryClient.invalidateQueries({ queryKey: ["embeddingStatus"] });
    } catch (err) { console.error("Failed to clear embeddings:", err); }
  };

  return (
    <div className="bg-white/80 dark:bg-[#2C2C2E] rounded-2xl border border-[#CDD5DB]/40 dark:border-transparent">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full text-left p-6 cursor-pointer"
      >
        <Settings className="h-5 w-5 text-[#4B6382] dark:text-zinc-400" />
        <h2 className="text-lg font-semibold text-[#071739] dark:text-white">Semantic Search</h2>
        <span className="text-xs text-[#A4B5C4] dark:text-zinc-500 ml-1">Coming Soon</span>
        {expanded ? <ChevronDown className="h-4 w-4 ml-auto text-[#A4B5C4] dark:text-zinc-500" /> : <ChevronRight className="h-4 w-4 ml-auto text-[#A4B5C4] dark:text-zinc-500" />}
      </button>

      {expanded && (
        <div className="px-6 pb-6 space-y-8">
        {/* Search Index Section */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-sm font-semibold text-[#071739] dark:text-white">Search Index</h3>
          </div>

          {/* Status */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-[#4B6382] dark:text-zinc-400">
                {status?.modelsLoaded ? (pipelineRunning ? "Indexing..." : "Ready") : "Models not loaded"}
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

        {/* Models Section */}
        <div className="bg-white/80 dark:bg-[#2C2C2E] rounded-2xl p-6 border border-[#CDD5DB]/40 dark:border-transparent">
          <div className="flex items-center gap-3 mb-4">
            <Download className="h-5 w-5 text-[#4B6382] dark:text-zinc-400" />
            <h2 className="text-lg font-semibold text-[#071739] dark:text-white">Search Models</h2>
            {diagnostics && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                diagnostics.overall === "ready" ? "bg-green-500/15 text-green-600 dark:text-green-400" :
                diagnostics.overall === "error" ? "bg-red-500/15 text-red-600 dark:text-red-400" :
                diagnostics.overall === "loading" ? "bg-[#007AFF]/15 text-[#007AFF]" :
                "bg-[#CDD5DB]/30 dark:bg-zinc-700 text-[#A4B5C4] dark:text-zinc-500"
              }`}>
                {diagnostics.overall === "ready" ? "Loaded" : diagnostics.overall === "loading" ? "Loading..." : diagnostics.overall === "error" ? "Not found" : "Pending"}
              </span>
            )}
          </div>

          {diagnostics?.overall !== "ready" && (
            <div className="mb-4">
              <p className="text-sm text-[#4B6382] dark:text-zinc-400 leading-relaxed">
                Semantic search requires model files. Download them from the iCapsule website and place them in the models folder.
              </p>
              <p className="text-xs text-[#A4B5C4] dark:text-zinc-500 mt-2">
                Required files: <code className="bg-[#CDD5DB]/30 dark:bg-zinc-700 px-1 rounded">mobileclip_s2_text.onnx</code>, <code className="bg-[#CDD5DB]/30 dark:bg-zinc-700 px-1 rounded">mobileclip_s2_vision.onnx</code>, <code className="bg-[#CDD5DB]/30 dark:bg-zinc-700 px-1 rounded">tokenizer.json</code>
              </p>
            </div>
          )}

          {modelsDir && (
            <div className="mb-4 rounded-lg bg-[#CDD5DB]/20 dark:bg-zinc-800/50 p-3 text-xs font-mono">
              <span className="text-[#4B6382] dark:text-zinc-400">Models directory</span>
              <p className="mt-0.5 text-[#071739] dark:text-zinc-300 break-all select-text">{modelsDir}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => openModelsDir().catch(console.error)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#CDD5DB]/30 dark:bg-zinc-700 text-[#4B6382] dark:text-zinc-300 hover:bg-[#CDD5DB]/50 dark:hover:bg-zinc-600 transition-colors text-sm cursor-pointer"
            >
              <FolderOpen className="h-4 w-4" />
              Open Folder
            </button>

            <button
              onClick={async () => {
                setReloading(true);
                try {
                  await reloadModels();
                } catch (err) {
                  console.error("Failed to reload models:", err);
                } finally {
                  setTimeout(() => setReloading(false), 2000);
                }
              }}
              disabled={reloading || diagnostics?.overall === "loading"}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#007AFF] text-white hover:bg-[#007AFF]/90 transition-colors text-sm disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} />
              {reloading ? "Loading..." : "Reload Models"}
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
            <div className="mt-4 space-y-4">
              {/* Model Status */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Cpu className="h-4 w-4 text-[#4B6382] dark:text-zinc-400" />
                  <span className="text-sm font-medium text-[#071739] dark:text-white">Model Status</span>
                  {diagnostics && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      diagnostics.overall === "ready" ? "bg-green-500/15 text-green-600 dark:text-green-400" :
                      diagnostics.overall === "error" ? "bg-red-500/15 text-red-600 dark:text-red-400" :
                      diagnostics.overall === "loading" ? "bg-[#007AFF]/15 text-[#007AFF]" :
                      "bg-[#CDD5DB]/30 dark:bg-zinc-700 text-[#A4B5C4] dark:text-zinc-500"
                    }`}>
                      {diagnostics.overall}
                    </span>
                  )}
                </div>

                {diagnostics && diagnostics.steps.length > 0 && (
                  <div className="space-y-1.5 ml-1">
                    {diagnostics.steps.map((step) => (
                      <div key={step.name} className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0">
                          <StepIcon status={step.status} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-[#071739] dark:text-zinc-200">
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

                {diagnostics && (diagnostics.ortDylibPath || diagnostics.modelsDir) && (
                  <div className="mt-2 rounded-md bg-[#CDD5DB]/15 dark:bg-zinc-800/40 p-2.5 space-y-1 text-xs font-mono">
                    {diagnostics.ortDylibPath && (
                      <div>
                        <span className="text-[#4B6382] dark:text-zinc-400">ORT dylib</span>
                        <p className="text-[#071739] dark:text-zinc-300 break-all select-text">{diagnostics.ortDylibPath}</p>
                      </div>
                    )}
                    {diagnostics.modelsDir && (
                      <div>
                        <span className="text-[#4B6382] dark:text-zinc-400">Models dir</span>
                        <p className="text-[#071739] dark:text-zinc-300 break-all select-text">{diagnostics.modelsDir}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-[#CDD5DB]/30 dark:border-zinc-700" />

              {/* Embedding Inspector */}
              <div>
                <p className="text-xs text-[#A4B5C4] dark:text-zinc-500 mb-3">
                  Inspect what has been embedded. Click each section to expand and view up to 50 most recent items.
                </p>
                <DebugSection sourceType="chunk" label="Conversation Chunks" />
                <DebugSection sourceType="message" label="Individual Messages" />
                <DebugSection sourceType="attachment" label="Images / Stickers" />
              </div>
            </div>
          )}
        </div>
        </div>
      )}
    </div>
  );
}

function ReplayTutorialButton() {
  const resetTutorial = useAppStore((s) => s.resetTutorial);
  return (
    <button
      onClick={resetTutorial}
      className="flex items-center gap-2 rounded-xl bg-[#3B82C4] hover:bg-[#2d6da3] text-white text-sm font-medium px-4 py-2.5 transition-colors cursor-pointer"
    >
      <RotateCcw className="h-4 w-4" />
      Replay Tutorial
    </button>
  );
}
