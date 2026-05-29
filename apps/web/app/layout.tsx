import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Checkup Pharmacy — Billing & Management",
  description: "Enterprise pharmacy billing and management platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
