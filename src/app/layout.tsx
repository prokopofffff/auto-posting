import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "autopost · dev dashboard",
  description:
    "Auto-generate and post news to LinkedIn and Telegram on your schedule, in your voice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('ap_theme');
                var a = localStorage.getItem('ap_accent');
                if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
                if (a && /^#[0-9a-f]{6}$/i.test(a)) {
                  var s = document.documentElement.style;
                  s.setProperty('--accent', a);
                  var r = parseInt(a.slice(1,3),16),
                      g = parseInt(a.slice(3,5),16),
                      b = parseInt(a.slice(5,7),16);
                  s.setProperty('--accent-bg', 'rgba('+r+','+g+','+b+',0.13)');
                  var lift = function(v){return Math.min(255, Math.round(v + (255-v)*0.15));};
                  s.setProperty('--accent-2', 'rgb('+lift(r)+','+lift(g)+','+lift(b)+')');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
