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

  // ── Search ──────────────────────────────────────
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // ── Chat list filter ────────────────────────────
  chatSearchQuery: string;
  setChatSearchQuery: (q: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "chat",
  setView: (view) => set({ view }),

  selectedChatId: null,
  setSelectedChatId: (selectedChatId) => set({ selectedChatId }),

  wrappedYear: new Date().getFullYear(),
  setWrappedYear: (wrappedYear) => set({ wrappedYear }),

  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  chatSearchQuery: "",
  setChatSearchQuery: (chatSearchQuery) => set({ chatSearchQuery }),
}));
