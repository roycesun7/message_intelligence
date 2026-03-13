import { create } from "zustand";

export type AppView = "chat" | "wrapped" | "search";

export interface AppState {
  // ── Navigation ──────────────────────────────────
  view: AppView;
  setView: (view: AppView) => void;

  // ── Selected chat ───────────────────────────────
  selectedChatId: number | null;
  setSelectedChatId: (id: number | null) => void;

  // ── Wrapped ─────────────────────────────────────
  wrappedYear: number;
  setWrappedYear: (year: number) => void;
  wrappedChatId: number | null;
  setWrappedChatId: (id: number | null) => void;

  // ── Search ──────────────────────────────────────
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // ── Chat list filter ────────────────────────────
  chatSearchQuery: string;
  setChatSearchQuery: (q: string) => void;

  // ── Scroll to message ───────────────────────────
  scrollToMessageDate: number | null;
  setScrollToMessageDate: (date: number | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "chat",
  setView: (view) => set({ view }),

  selectedChatId: null,
  setSelectedChatId: (selectedChatId) => set({ selectedChatId }),

  wrappedYear: 0, // 0 = all-time by default
  setWrappedYear: (wrappedYear) => set({ wrappedYear }),

  wrappedChatId: null,
  setWrappedChatId: (wrappedChatId) => set({ wrappedChatId }),

  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  chatSearchQuery: "",
  setChatSearchQuery: (chatSearchQuery) => set({ chatSearchQuery }),

  scrollToMessageDate: null,
  setScrollToMessageDate: (scrollToMessageDate) => set({ scrollToMessageDate }),
}));
