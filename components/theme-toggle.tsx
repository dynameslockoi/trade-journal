"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const light = mounted && resolvedTheme === "light";
  const label = light ? "Switch to dark mode" : "Switch to light mode";

  return (
    <Button
      variant="secondary"
      className="theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setTheme(light ? "dark" : "light")}
    >
      {light ? <Moon size={16} /> : <Sun size={16} />}
    </Button>
  );
}
