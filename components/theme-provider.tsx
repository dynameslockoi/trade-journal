"use client";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Keeps the chosen theme on <html data-theme>, and prevents the light/dark flash on load. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="data-theme" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
