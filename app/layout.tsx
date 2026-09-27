import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Group Trip Decider",
  description: "Five friends, one link, one trip everyone actually agrees on.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f766e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh antialiased">
        <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-4">{children}</main>
      </body>
    </html>
  );
}
