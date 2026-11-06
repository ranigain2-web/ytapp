import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { THEME_BOOT_SCRIPT } from "@/lib/yt-theme";

// Self-hosted Roboto (variable, latin). Was next/font/google — the CI runners
// intermittently fail to fetch fonts.googleapis.com ("next/font/google
// queries have exactly one entry"), which broke builds on otherwise
// identical commits. A 43KB local woff2 removes the network dependency
// entirely; the variable file covers 400/500/700.
const roboto = localFont({
  src: "../fonts/roboto-var.woff2",
  variable: "--font-roboto",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "YouTube",
  description: "Watch videos — ad-free",
  applicationName: "YouTube",
  manifest: "/manifest.webmanifest", // phase 6: installable PWA on web
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0f" }, // hex-ok: the dark theme value itself
    { media: "(prefers-color-scheme: light)", color: "#ffffff" }, // hex-ok: the light theme value itself
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark yt-dark" suppressHydrationWarning>
      <head>
        {/* apply the stored theme before first paint — no dark/light flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      {/* NOTE: no hardcoded bg/text utilities here. `bg-[#0f0f0f]` out-specifies
          the `body { background: var(--yt-bg) }` rule in globals.css, which
          pinned the whole app to the dark palette even in light theme. Themed
          tokens are applied in CSS so light mode actually goes light. */}
      <body className={`${roboto.variable} font-sans antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
