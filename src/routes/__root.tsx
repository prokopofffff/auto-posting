/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";

// IBM Plex fonts (replaces next/font/google). @fontsource injects the @font-face
// rules; globals.css maps --font-plex-sans / --font-plex-mono to these families.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";

import "@/styles/globals.css";

// Runs before hydration to apply the persisted theme/accent from localStorage,
// avoiding a flash. Ported VERBATIM from src/app/layout.tsx's <head> script.
const THEME_BOOTSTRAP = `
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
`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "autopost · dev dashboard" },
      {
        name: "description",
        content:
          "Auto-generate and post news to LinkedIn and Telegram on your schedule, in your voice.",
      },
    ],
    scripts: [
      // Theme bootstrap must run before paint — inline in <head>.
      { children: THEME_BOOTSTRAP },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument() {
  return (
    <html
      lang="en"
      data-theme="dark"
      className="font-sans h-full antialiased"
    >
      <head>
        <HeadContent />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Outlet />
        <Toaster richColors position="top-right" />
        <Scripts />
      </body>
    </html>
  );
}
