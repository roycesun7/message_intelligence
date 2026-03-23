"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";

/**
 * Tracks tab usage and Capsule sub-tab views via PostHog.
 * No message content is ever sent — only navigation events.
 *
 * Events:
 *   tab_switched    — when user changes tabs, includes time_spent_seconds on previous tab
 *   capsule_tab_viewed — when user views a Capsule sub-tab (Overview, Between You Two, etc.)
 *   tutorial_completed — when tutorial finishes
 *   tutorial_skipped   — when tutorial is skipped
 */
export function useAnalyticsTracking() {
  const view = useAppStore((s) => s.view);
  const capsuleTab = useAppStore((s) => s.capsuleTab);
  const tutorialStep = useAppStore((s) => s.tutorialStep);

  const prevView = useRef(view);
  const viewEnteredAt = useRef(Date.now());
  const prevTutorialStep = useRef(tutorialStep);

  // Track tab switches with time spent
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    if (view === prevView.current) return;

    const timeSpent = Math.round((Date.now() - viewEnteredAt.current) / 1000);

    (async () => {
      try {
        const posthog = (await import("posthog-js")).default;
        posthog.capture("tab_switched", {
          from_tab: prevView.current,
          to_tab: view,
          time_spent_seconds: timeSpent,
        });
      } catch {}
    })();

    prevView.current = view;
    viewEnteredAt.current = Date.now();
  }, [view]);

  // Track Capsule sub-tab views
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    if (view !== "capsule") return;

    (async () => {
      try {
        const posthog = (await import("posthog-js")).default;
        posthog.capture("capsule_tab_viewed", {
          tab: capsuleTab,
        });
      } catch {}
    })();
  }, [capsuleTab, view]);

  // Track tutorial completion/skip
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    const prev = prevTutorialStep.current;
    prevTutorialStep.current = tutorialStep;

    // Tutorial just ended (was a number, now null)
    if (prev !== null && tutorialStep === null) {
      const event = prev >= 3 ? "tutorial_completed" : "tutorial_skipped";
      (async () => {
        try {
          const posthog = (await import("posthog-js")).default;
          posthog.capture(event);
        } catch {}
      })();
    }
  }, [tutorialStep]);
}
