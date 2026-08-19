import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClaimIQ — AI-Assisted Motor Claims Decision Workbench",
  description: "AI-assisted motor insurance claims decision-support application",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
