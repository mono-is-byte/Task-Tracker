import type { Metadata } from "next";
import { Noto_Sans_Bengali, Inter } from "next/font/google";
import "./globals.css";

const bengali = Noto_Sans_Bengali({ subsets: ["bengali", "latin"], variable: "--font-bengali", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "TaskTracker",
  description: "Self-hosted team task tracker — Kanban, timeline, calendar and reports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${bengali.variable} bg-slate-100 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100`}>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('tt_theme');if(!t){var m=document.cookie.match(/tt_theme=([^;]+)/);t=m&&m[1]}if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.classList.toggle('dark',t==='dark')}catch(e){}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
