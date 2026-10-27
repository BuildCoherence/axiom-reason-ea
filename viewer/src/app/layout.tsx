import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { SiteNav } from "@/components/site-nav";
import { ThemeProvider } from "@/components/theme/theme-provider";
import {
  SITE_DESCRIPTION,
  SITE_TITLE,
  SITE_URL,
  STATIC_OG_IMAGE,
} from "@/lib/site";
import { PRE_PAINT_THEME_SCRIPT } from "@/lib/theme/pre-paint-script";
import {
  commissioner,
  dmSans,
  juliaMono,
  libreBaskerville,
  ptSerif,
} from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  icons: {
    icon: [
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: { siteName: "Axiom", images: [STATIC_OG_IMAGE] },
  twitter: { card: "summary_large_image", images: [STATIC_OG_IMAGE] },
};

// No `user-scalable=no`: blocking pinch-zoom fails WCAG 1.4.4.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const fontVariables = [
    dmSans.variable,
    juliaMono.variable,
    ptSerif.variable,
    libreBaskerville.variable,
    commissioner.variable,
  ].join(" ");

  return (
    // suppressHydrationWarning: the pre-paint script sets the theme on <html>.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Runs before paint so the saved theme applies without a flash. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: PRE_PAINT_THEME_SCRIPT }}
        />
      </head>
      <body className="bg-background text-foreground font-sans antialiased">
        <ThemeProvider>
          <div className="flex min-h-dvh flex-col">
            <SiteNav />
            <main
              id="main-content"
              tabIndex={-1}
              className="flex min-h-0 flex-1 flex-col pt-[var(--ce-nav-height)]"
            >
              {children}
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
