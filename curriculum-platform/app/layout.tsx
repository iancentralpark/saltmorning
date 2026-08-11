import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import Link from "next/link";
import { EmbedMode } from "@/components/EmbedMode";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "CurricuMap — K-12 Curriculum Mapping",
  description:
    "Interactive curriculum mindmaps and AI lesson planning across CCSS, NGSS, and Korea 2022 standards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${sans.variable} font-sans antialiased`}>
        <EmbedMode />
        <div className="min-h-screen">
          <header className="site-header sticky top-0 z-40 border-b border-ink-900/10 bg-sand-50/80 backdrop-blur-md">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
              <Link href="/" className="group flex items-baseline gap-2">
                <span className="font-display text-2xl font-semibold tracking-tight text-ink-900">
                  CurricuMap
                </span>
                <span className="hidden text-sm text-ink-700/70 sm:inline">
                  K–12 curriculum · AI plans
                </span>
              </Link>
              <nav
                className="flex items-center text-sm font-medium text-ink-800"
                style={{ gap: "0.5rem" }}
              >
                <OrgSwitcher />
                <Link
                  href="/map"
                  className="rounded-md px-3 py-1.5 transition hover:bg-moss-100 hover:text-moss-700"
                >
                  Mindmap
                </Link>
                <Link
                  href="/schedule"
                  className="rounded-md px-3 py-1.5 transition hover:bg-moss-100 hover:text-moss-700"
                >
                  Schedule
                </Link>
                <Link
                  href="/docs/api"
                  className="rounded-md px-3 py-1.5 transition hover:bg-moss-100 hover:text-moss-700"
                >
                  Portal API
                </Link>
              </nav>
            </div>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
