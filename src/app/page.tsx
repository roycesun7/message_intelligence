"use client";

import { MessageSquare, BarChart3, Search } from "lucide-react";

import { useAppStore, type AppView } from "@/stores/app-store";
import { ChatList } from "@/components/chat/chat-list";
import { ChatView } from "@/components/chat/chat-view";
import { WrappedView } from "@/components/wrapped/wrapped-view";
import { GlobalSearch } from "@/components/search/global-search";

// ── Nav tabs ──────────────────────────────────────────────
const NAV_ITEMS: { id: AppView; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chats", icon: MessageSquare },
  { id: "wrapped", label: "Wrapped", icon: BarChart3 },
  { id: "search", label: "Search", icon: Search },
];

function NavBar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);

  return (
    <nav className="flex h-11 shrink-0 items-center gap-1 glass glass-border shadow-[0_1px_8px_rgba(0,0,0,0.25)] px-4 relative z-10">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const isActive = view === id;
        return (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-200 apple-text-sm ${
              isActive
                ? "bg-[#007AFF]/20 text-[#007AFF] shadow-[0_0_12px_rgba(0,122,255,0.15)]"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        );
      })}

      <div className="ml-auto text-xs font-medium text-zinc-600 apple-text-xs">
        Message Intelligence
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
    case "chat":
    default:
      return <ChatView />;
  }
}

// ── Page ──────────────────────────────────────────────────
export default function Home() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#1C1C1E]">
      <NavBar />
      <div className="flex min-h-0 flex-1">
        <ChatList />
        <main className="relative min-h-0 min-w-0 flex-1 overflow-auto">
          <MainContent />
        </main>
      </div>
    </div>
  );
}
