import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import PlayerSheetProvider from "@/components/PlayerSheet";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

// Fonts come from the geist package (bundled files), so builds never depend on
// reaching Google Fonts.

export const metadata: Metadata = {
  title: "FPL Raptor",
  description: "Deadlines, alerts, transfer ideas and mini-league banter for Fantasy Premier League.",
  // Lets iPhones open it full-screen from the Home Screen, like an app.
  appleWebApp: { capable: true, title: "FPL Raptor", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  viewportFit: "cover", // lets the phone tab bar sit above the iPhone home indicator
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#101612" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <SiteHeader />
        <PlayerSheetProvider>
          <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">{children}</div>
        </PlayerSheetProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
