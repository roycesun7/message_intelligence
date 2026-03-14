"use client";

import { MessageSquare, BarChart3, Search, Settings, Sun, Moon } from "lucide-react";

import { useAppStore, type AppView } from "@/stores/app-store";
import { ChatList } from "@/components/chat/chat-list";
import { ChatView } from "@/components/chat/chat-view";
import { WrappedView } from "@/components/wrapped/wrapped-view";
import { GlobalSearch } from "@/components/search/global-search";
import { SettingsPage } from "@/components/settings/settings-page";
import { IndexingStatusBar } from "@/components/layout/indexing-status-bar";
import { FdaGate } from "@/components/onboarding/fda-gate";

// ── Nav tabs ──────────────────────────────────────────────
const NAV_ITEMS: { id: AppView; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chats", icon: MessageSquare },
  { id: "wrapped", label: "Wrapped", icon: BarChart3 },
  { id: "search", label: "Search", icon: Search },
  { id: "settings", label: "Settings", icon: Settings },
];

function NavBar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  return (
    <nav className="flex h-11 shrink-0 items-center gap-1 rounded-2xl bg-[#F7F8FA]/80 dark:bg-[#2A2A2C]/60 backdrop-blur-2xl saturate-[1.2] dark:saturate-[1.8] border border-[#D1D5DB]/30 dark:border-white/[0.08] shadow-[0_2px_20px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_24px_rgba(0,0,0,0.4)] px-4 relative z-10 mx-2 mt-2">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const isActive = view === id;
        return (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium tracking-wide transition-all duration-200 apple-text-sm ${
              isActive
                ? "bg-[#1B2432]/10 text-[#1B2432] dark:bg-[#007AFF]/20 dark:text-[#007AFF]"
                : "text-[#4E5D6E] hover:text-[#1B2432] hover:bg-[#1B2432]/[0.05] dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-white/[0.05]"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        );
      })}

      <div className="ml-auto flex items-center gap-3">
        <IndexingStatusBar />
        <button
          onClick={toggleTheme}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#4E5D6E] dark:text-zinc-400 hover:bg-[#1B2432]/[0.05] dark:hover:bg-white/[0.05] transition-colors"
          title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        >
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
      </div>
    </nav>
  );
}

// ── Right panel content ───────────────────────────────────
function MainContent() {
  const view = useAppStore((s) => s.view);

  switch (view) {
    case "wrapped":
      return <WrappedView />;
    case "search":
      return <GlobalSearch />;
    case "settings":
      return <SettingsPage />;
    case "chat":
    default:
      return <ChatView />;
  }
}

// ── Page ──────────────────────────────────────────────────
export default function Home() {
  return (
    <FdaGate>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#ECEEF2] dark:bg-zinc-950">
        <NavBar />
        <div className="flex min-h-0 flex-1 gap-0 p-2">
          <ChatList />
          <main className="relative min-h-0 min-w-0 flex-1 overflow-auto">
            <MainContent />
          </main>
        </div>
      </div>
    </FdaGate>
  );
}
