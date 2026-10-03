"use client";

import { useEffect } from "react";

// Registers /sw.js once per page load so the app can receive push
// notifications and be installed to the home screen.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
        // Not fatal: the site works without it, just without notifications.
      });
    }
  }, []);
  return null;
}
