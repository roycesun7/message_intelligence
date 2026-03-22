import { create } from "zustand";

export type AppView = "chat" | "capsule" | "search" | "settings";
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
  // ── Tutorial ──────────────────────────────────
  tutorialStep: number | null;  // null = done/skipped
  advanceTutorial: () => void;
  skipTutorial: () => void;
  resetTutorial: () => void;

  // ── Navigation ──────────────────────────────────
  view: AppView;
  setView: (view: AppView) => void;

  // ── Theme ─────────────────────────────────────
  theme: Theme;
  toggleTheme: () => void;

  // ── Selected chat ───────────────────────────────
  selectedChatId: number | null;
  setSelectedChatId: (id: number | null) => void;

  // ── Capsule ─────────────────────────────────────
  capsuleYear: number;
  setCapsuleYear: (year: number) => void;
  capsuleChatId: number | null;
  setCapsuleChatId: (id: number | null) => void;

  // ── Capsule tab ───────────────────────────────────
  capsuleTab: string;
  setCapsuleTab: (tab: string) => void;

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

function getTutorialStart(): number | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("hasCompletedTutorial") ? null : 1;
}

function completeTutorial() {
  if (typeof window !== "undefined") {
    localStorage.setItem("hasCompletedTutorial", "true");
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  tutorialStep: getTutorialStart(),
  advanceTutorial: () => {
    const step = get().tutorialStep;
    if (step === null) return;
    if (step >= 3) {
      completeTutorial();
      set({ tutorialStep: null });
    } else {
      set({ tutorialStep: step + 1 });
    }
  },
  skipTutorial: () => {
    completeTutorial();
    set({ tutorialStep: null });
  },
  resetTutorial: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("hasCompletedTutorial");
    }
    set({ tutorialStep: 1, view: "chat", selectedChatId: null, capsuleChatId: null });
  },

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

  capsuleYear: 0, // 0 = all-time by default
  setCapsuleYear: (capsuleYear) => set({ capsuleYear }),

  capsuleChatId: null,
  setCapsuleChatId: (capsuleChatId) => set({ capsuleChatId, capsuleTab: "overview" }),

  capsuleTab: "overview",
  setCapsuleTab: (capsuleTab) => set({ capsuleTab }),

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
