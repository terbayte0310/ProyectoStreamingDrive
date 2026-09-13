import type { Metadata } from "next";
import "./globals.css";

import { SessionSignOutCoordinator } from "@/components/session-sign-out-coordinator";

export const metadata: Metadata = {
  title: { default: "Nébula", template: "%s · Nébula" },
  description: "Tu espacio privado para aprender, avanzar y volver a empezar.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html data-scroll-behavior="smooth" lang="es" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem("nebula-theme")==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col"><SessionSignOutCoordinator />{children}</body>
    </html>
  );
}
