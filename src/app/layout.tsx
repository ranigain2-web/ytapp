import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { THEME_BOOT_SCRIPT } from "@/lib/yt-theme";

const roboto = Roboto({
  variable: "--font-roboto",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "YouTube",
  description: "Watch videos — ad-free",
  applicationName: "YouTube",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0f" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
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
      <body className={`${roboto.variable} font-sans antialiased bg-[#0f0f0f] text-[#f1f1f1]`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
