import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PostureProvider } from "@/lib/posture";
import { MetaConstantsProvider } from "@/lib/meta";
import { AppShell } from "@/components/kit/AppShell";
import { DegradationBanner } from "@/components/DegradationBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Solvent · ether.fi risk observatory",
    template: "%s · Solvent",
  },
  description:
    "A public, verifiable risk-control system: every number explained, every uncertainty named, every stress consequence priced honestly.",
};

/**
 * Applies a stored explicit theme BEFORE first paint so an overridden theme
 * never flashes the system one. Kept tiny and inline; the ThemeToggle owns
 * all later changes. Absence of the key = system (media query rules).
 */
const THEME_INIT = `try{var t=localStorage.getItem("solvent-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <PostureProvider>
          {/* p1a-4: one /v1/meta ask per tab — the tier constants the appbar's
              snapshot chip styles itself by (fallback disclosed on failure). */}
          <MetaConstantsProvider>
            <AppShell />
            <DegradationBanner />
            <main className="shell">{children}</main>
          </MetaConstantsProvider>
        </PostureProvider>
      </body>
    </html>
  );
}
