import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// Theme is driven by the `data-theme` attribute on <html> (set by the inline
// bootstrap script in __root.tsx from localStorage), so there is no next-themes
// provider. We read it from document.documentElement.dataset.theme after mount;
// "dark" is the SSR/initial default (matches <html data-theme="dark"> in
// __root.tsx). Sonner otherwise follows the CSS variables below.
type SonnerTheme = ToasterProps["theme"]

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = useState<SonnerTheme>("dark")

  useEffect(() => {
    const read = () => {
      const t = document.documentElement.dataset.theme
      setTheme(t === "light" || t === "dark" ? t : "dark")
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    })
    return () => observer.disconnect()
  }, [])

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
