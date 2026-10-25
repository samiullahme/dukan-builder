import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import buildInfo from "@/lib/build-info.json";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Dukan Builder — Describe your shop, get a website",
  description:
    "An AI website builder for small shops. Describe your business, refine it over chat, preview, download the code, and publish to a free live URL.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const builtAt = `${buildInfo.builtAt.replace("T", " ").slice(0, 16)} UTC`;
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body>
        {children}
        <div
          className="fixed bottom-3 left-3 z-50 select-none rounded-md border border-slate-200 bg-white/90 px-2 py-1 font-mono text-[10px] leading-none text-slate-500 shadow-sm backdrop-blur"
          title={`Dukan Builder v${buildInfo.version}, built ${buildInfo.builtAt}`}
        >
          v{buildInfo.version} · {builtAt}
        </div>
      </body>
    </html>
  );
}
