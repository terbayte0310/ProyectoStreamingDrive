import type { Metadata } from "next";
import "./globals.css";
import "./redesign.css";

import { SessionSignOutCoordinator } from "@/components/session-sign-out-coordinator";
import { TransferUsageNotice } from "@/components/transfer-usage-notice";

export const metadata: Metadata = {
  title: { default: "Nébula", template: "%s · Nébula" },
  description: "Tu biblioteca privada de películas, series y cursos. Una historia para cada momento.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html data-scroll-behavior="smooth" lang="es" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem("nebula-theme")==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col"><SessionSignOutCoordinator /><TransferUsageNotice />{children}</body>
    </html>
  );
}
