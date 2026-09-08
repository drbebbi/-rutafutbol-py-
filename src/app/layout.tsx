import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "../ui/components/app-shell";

export const metadata: Metadata = {
  title: "Cedula PY",
  description:
    "Understand and organise your first Paraguayan cedula. Cedula PY explains what applies to your situation and says so plainly when something still needs official verification.",
  applicationName: "Cedula PY",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
