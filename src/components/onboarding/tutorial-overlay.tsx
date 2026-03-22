"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/stores/app-store";

interface StepConfig {
  target: string;
  title: string;
  description: string;
  tooltipPosition: "right" | "below";
  borderRadius: number;
  padding: number;
}

const STEPS: StepConfig[] = [
  {
    target: "chat-list",
    title: "Your Conversations",
    description: "Browse your conversations here. Click any chat to read your messages.",
    tooltipPosition: "right",
    borderRadius: 16,
    padding: 4,
  },
  {
    target: "capsule-tab",
    title: "Discover Capsule",
    description:
      "Tap Capsule for insights across all your messages \u2014 trends, personality, most-used words, and more.",
    tooltipPosition: "below",
    borderRadius: 20,
    padding: 4,
  },
  {
    target: "chat-list",
    title: "Per-Conversation Insights",
    description:
      "Click any conversation here to see insights just for that person or group.",
    tooltipPosition: "right",
    borderRadius: 16,
    padding: 4,
  },
];

export function TutorialOverlay() {
  const tutorialStep = useAppStore((s) => s.tutorialStep);
  const advanceTutorial = useAppStore((s) => s.advanceTutorial);
  const skipTutorial = useAppStore((s) => s.skipTutorial);

  const [rect, setRect] = useState<DOMRect | null>(null);

  const measure = useCallback(() => {
    if (tutorialStep === null) return;
    const config = STEPS[tutorialStep - 1];
    if (!config) return;
    const el = document.querySelector(`[data-tutorial="${config.target}"]`);
    if (el) {
      setRect(el.getBoundingClientRect());
    }
  }, [tutorialStep]);

  // Measure on step change
  useEffect(() => {
    if (tutorialStep === null) return;
    measure();
    const t1 = requestAnimationFrame(measure);
    const t2 = setTimeout(measure, 150);
    const t3 = setTimeout(measure, 400);
    return () => {
      cancelAnimationFrame(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [tutorialStep, measure]);

  // Re-measure on resize
  useEffect(() => {
    if (tutorialStep === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [tutorialStep, measure]);

  // Listen for clicks on the target to advance
  useEffect(() => {
    if (tutorialStep === null) return;
    const config = STEPS[tutorialStep - 1];
    if (!config) return;

    const handler = () => {
      if (tutorialStep === 2) {
        setTimeout(advanceTutorial, 300);
      } else {
        advanceTutorial();
      }
    };

    const el = document.querySelector(`[data-tutorial="${config.target}"]`);
    if (el) {
      el.addEventListener("click", handler, true);
      return () => el.removeEventListener("click", handler, true);
    }
  }, [tutorialStep, advanceTutorial]);

  if (tutorialStep === null || !rect) return null;

  const config = STEPS[tutorialStep - 1];
  if (!config) return null;

  const pad = config.padding;
  const cutout = {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };

  // Tooltip positioning
  let tooltipStyle: React.CSSProperties;
  if (config.tooltipPosition === "right") {
    tooltipStyle = {
      position: "fixed",
      top: cutout.top + 20,
      left: cutout.left + cutout.width + 16,
      maxWidth: 300,
    };
  } else {
    tooltipStyle = {
      position: "fixed",
      top: cutout.top + cutout.height + 12,
      left: cutout.left,
      maxWidth: 340,
    };
  }

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Cutout element — transparent box with massive box-shadow acting as overlay */}
      <div
        className="absolute transition-all duration-300 ease-out"
        style={{
          top: cutout.top,
          left: cutout.left,
          width: cutout.width,
          height: cutout.height,
          borderRadius: config.borderRadius,
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
        }}
      />

      {/* Pulse ring */}
      <div
        className="absolute"
        style={{
          top: cutout.top,
          left: cutout.left,
          width: cutout.width,
          height: cutout.height,
          borderRadius: config.borderRadius,
          border: "2px solid rgba(59, 130, 196, 0.5)",
          animation: "tutorial-pulse 2s ease-in-out infinite",
        }}
      />

      {/* Click blockers — cover everything EXCEPT the cutout, pointer-events-auto to block clicks on dimmed areas */}
      {/* Top */}
      <div className="absolute top-0 left-0 right-0 pointer-events-auto" style={{ height: Math.max(0, cutout.top) }} />
      {/* Bottom */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-auto" style={{ top: cutout.top + cutout.height }} />
      {/* Left */}
      <div className="absolute left-0 pointer-events-auto" style={{ top: cutout.top, width: Math.max(0, cutout.left), height: cutout.height }} />
      {/* Right */}
      <div className="absolute right-0 pointer-events-auto" style={{ top: cutout.top, left: cutout.left + cutout.width, height: cutout.height }} />

      {/* Tooltip card */}
      <div
        style={tooltipStyle}
        className="pointer-events-auto rounded-2xl bg-white/95 dark:bg-[#2A2A2C]/95 backdrop-blur-xl border border-[#D1D5DB]/40 dark:border-white/[0.1] shadow-[0_8px_32px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-5"
      >
        <h3 className="text-[15px] font-bold text-[#1B2432] dark:text-white mb-1.5">
          {config.title}
        </h3>
        <p className="text-[13px] text-[#4E5D6E] dark:text-zinc-400 leading-relaxed mb-4">
          {config.description}
        </p>

        <div className="flex items-center justify-between">
          {/* Step dots */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === tutorialStep - 1
                    ? "w-4 bg-[#3B82C4]"
                    : i < tutorialStep - 1
                      ? "w-1.5 bg-[#3B82C4]/40"
                      : "w-1.5 bg-[#D1D5DB] dark:bg-zinc-600"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={skipTutorial}
              className="text-[11px] text-[#94A3B3] dark:text-zinc-500 hover:text-[#4E5D6E] dark:hover:text-zinc-300 transition-colors cursor-pointer"
            >
              Skip
            </button>
            {tutorialStep === 3 && (
              <button
                onClick={advanceTutorial}
                className="text-[12px] font-semibold text-white bg-[#3B82C4] hover:bg-[#2d6da3] rounded-full px-4 py-1.5 transition-colors cursor-pointer"
              >
                Got it
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
