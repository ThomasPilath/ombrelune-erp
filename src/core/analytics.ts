import type { PublicEnv } from "../config/env";

const TRACKER_ID = "umami-tracker";

export function initializeAnalytics(env: PublicEnv): void {
  if (!env.VITE_UMAMI_SCRIPT_URL || !env.VITE_UMAMI_WEBSITE_ID) return;
  if (document.getElementById(TRACKER_ID)) return;

  const tracker = document.createElement("script");
  tracker.id = TRACKER_ID;
  tracker.defer = true;
  tracker.src = env.VITE_UMAMI_SCRIPT_URL;
  tracker.dataset.websiteId = env.VITE_UMAMI_WEBSITE_ID;
  tracker.dataset.doNotTrack = "true";
  document.head.append(tracker);
}
