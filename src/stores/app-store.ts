import { create } from "zustand";

export type AppView = "chat" | "wrapped" | "search" | "settings";
export type Theme = "light" | "dark";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return (localStorage.getItem("theme") as Theme) ?? "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  if (theme === "dark") {
    html.classList.add("dark");
  } else {
    html.classList.remove("dark");
  }
  localStorage.setItem("theme", theme);
}

export interface AppState {
  // ── Navigation ──────────────────────────────────
  view: AppView;
  setView: (view: AppView) => void;

  // ── Theme ─────────────────────────────────────
  theme: Theme;
  toggleTheme: () => void;

  // ── Selected chat ───────────────────────────────
  selectedChatId: number | null;
  setSelectedChatId: (id: number | null) => void;

  // ── Wrapped ─────────────────────────────────────
  wrappedYear: number;
  setWrappedYear: (year: number) => void;
  wrappedChatId: number | null;
  setWrappedChatId: (id: number | null) => void;

  // ── Wrapped tab ───────────────────────────────────
  wrappedTab: string;
  setWrappedTab: (tab: string) => void;

  // ── Search ──────────────────────────────────────
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // ── Chat list filter ────────────────────────────
  chatSearchQuery: string;
  setChatSearchQuery: (q: string) => void;

  // ── Scroll to message ───────────────────────────
  scrollToMessageDate: number | null;
  scrollToMessageRowid: number | null;
  setScrollToMessageDate: (date: number | null, rowid?: number | null) => void;

  // ── Highlight a message after scrolling ────────────
  highlightedMessageDate: number | null;
  setHighlightedMessageDate: (date: number | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: "chat",
  setView: (view) => set({ view }),

  theme: getStoredTheme(),
  toggleTheme: () => {
    const next = get().theme === "light" ? "dark" : "light";
    applyTheme(next);
    set({ theme: next });
  },

  selectedChatId: null,
  setSelectedChatId: (selectedChatId) => set({ selectedChatId }),

  wrappedYear: 0, // 0 = all-time by default
  setWrappedYear: (wrappedYear) => set({ wrappedYear }),

  wrappedChatId: null,
  setWrappedChatId: (wrappedChatId) => set({ wrappedChatId, wrappedTab: "overview" }),

  wrappedTab: "overview",
  setWrappedTab: (wrappedTab) => set({ wrappedTab }),

  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  chatSearchQuery: "",
  setChatSearchQuery: (chatSearchQuery) => set({ chatSearchQuery }),

  scrollToMessageDate: null,
  scrollToMessageRowid: null,
  setScrollToMessageDate: (scrollToMessageDate, scrollToMessageRowid = null) =>
    set({ scrollToMessageDate, scrollToMessageRowid }),

  highlightedMessageDate: null,
  setHighlightedMessageDate: (highlightedMessageDate) => set({ highlightedMessageDate }),
}));
