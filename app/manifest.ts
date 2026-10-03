import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FPL Raptor",
    short_name: "FPL Raptor",
    description: "Deadlines, alerts and mini-league banter for Fantasy Premier League.",
    start_url: "/me",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#059669",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
