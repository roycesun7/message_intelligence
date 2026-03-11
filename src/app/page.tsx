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
    <nav className="flex h-11 shrink-0 items-center gap-1 border-b border-white/10 bg-zinc-900 px-4">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const isActive = view === id;
        return (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-blue-600/20 text-blue-400"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        );
      })}

      <div className="ml-auto text-xs font-medium text-zinc-600">
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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950">
      <NavBar />
      <div className="flex flex-1 overflow-hidden">
        <ChatList />
        <MainContent />
      </div>
    </div>
  );
}
