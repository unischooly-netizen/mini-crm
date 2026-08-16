import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TLS - Presales CRM",
  description: "Simple lead calling dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
