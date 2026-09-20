import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { ViewTransition } from "react";

import "./globals.css";

import { InteractionLayer } from "@/components/interaction-layer";
import { SessionSignOutCoordinator } from "@/components/session-sign-out-coordinator";
import { Toaster } from "@/components/toaster";
import { TransferUsageNotice } from "@/components/transfer-usage-notice";

const display = Bricolage_Grotesque({ axes: ["opsz", "wdth"], display: "swap", subsets: ["latin"], variable: "--font-bricolage" });
const body = Geist({ display: "swap", subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ display: "swap", subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "Nébula", template: "%s · Nébula" },
  description: "Tu biblioteca privada de películas, series y cursos. Una historia para cada momento.",
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { color: "#f3efe7", media: "(prefers-color-scheme: light)" },
    { color: "#08070c", media: "(prefers-color-scheme: dark)" },
  ],
};

// Runs before first paint: the stored choice wins, otherwise the system decides.
const themeScript = `try{var t=localStorage.getItem("nebula-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html className={`${display.variable} ${body.variable} ${mono.variable}`} data-scroll-behavior="smooth" lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SessionSignOutCoordinator />
        <InteractionLayer />
        <ViewTransition default="nb-page">
          <div className="app-root">{children}</div>
        </ViewTransition>
        <TransferUsageNotice />
        <Toaster />
      </body>
    </html>
  );
}
