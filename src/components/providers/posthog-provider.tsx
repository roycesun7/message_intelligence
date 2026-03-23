"use client";

import { useEffect } from "react";

const POSTHOG_API_KEY = "phc_tmwhlLnIIeZvPkefDfkWQsUOnWw1T8bYbSGqj5VFBNm";
const POSTHOG_HOST = "https://us.i.posthog.com";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Skip in dev
    if (process.env.NODE_ENV === "development") return;

    async function init() {
      const posthog = (await import("posthog-js")).default;
      posthog.init(POSTHOG_API_KEY, {
        api_host: POSTHOG_HOST,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: true,
        persistence: "localStorage",
      });
      posthog.register({ source: "app" });
    }
    init();
  }, []);

  return <>{children}</>;
}
