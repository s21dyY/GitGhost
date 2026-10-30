import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitGhost: every repo has a ghost",
  description:
    "A graveyard of real public GitHub repositories. Pick a tombstone to see the project.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
