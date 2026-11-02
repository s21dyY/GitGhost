import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ScreenFx } from "@/components/fx/transitions";
import "./globals.css";
import "./horror.css";

// Self-hosted fonts (SIL Open Font License; see the OFL-*.txt files beside them). No network at build.
const pixel = localFont({ src: "./fonts/PressStart2P-Regular.ttf", variable: "--font-pixel", display: "swap" });
const label = localFont({
  src: [
    { path: "./fonts/Silkscreen-Regular.ttf", weight: "400" },
    { path: "./fonts/Silkscreen-Bold.ttf", weight: "700" },
  ],
  variable: "--font-label",
  display: "swap",
});
const body = localFont({
  src: [
    { path: "./fonts/AtkinsonHyperlegible-Regular.ttf", weight: "400" },
    { path: "./fonts/AtkinsonHyperlegible-Bold.ttf", weight: "700" },
  ],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GitGhost: every repo has a ghost",
  description: "A haunted graveyard of real public GitHub repositories. Summon a ghost and ask it what happened.",
};

// On phones the on-screen keyboard shrinks the page itself, so the question box stays in view.
export const viewport: Viewport = { interactiveWidget: "resizes-content", themeColor: "#0c1020" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${pixel.variable} ${label.variable} ${body.variable}`}>
      <body className="min-h-full flex flex-col">
        <a href="#main" className="skip-link">Skip to content</a>
        {children}
        <ScreenFx />
      </body>
    </html>
  );
}
