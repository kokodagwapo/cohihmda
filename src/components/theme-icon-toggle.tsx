import { useTheme } from "@/components/theme-provider";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

export function ThemeIconToggle() {
  const { theme, setTheme } = useTheme();
  const [isDark, setIsDark] = useState(() => {
    if (theme === "dark") return true;
    if (theme === "light") return false;
    return document.documentElement.classList.contains("dark");
  });

  useEffect(() => {
    // Update isDark based on current theme
    const newIsDark = theme === "dark" 
      ? true 
      : theme === "light" 
      ? false 
      : document.documentElement.classList.contains("dark");
    
    setIsDark(newIsDark);

    // Watch for class changes on documentElement (for system theme changes)
    const observer = new MutationObserver(() => {
      const currentIsDark = document.documentElement.classList.contains("dark");
      // Only update if theme is "system" (user hasn't explicitly set it)
      if (theme === "system") {
        setIsDark(currentIsDark);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [theme]);

  const toggle = () => {
    const newTheme = isDark ? "light" : "dark";
    setTheme(newTheme);
  };

  return (
    <button
      onClick={toggle}
      className={cn(
        "relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isDark ? "bg-blue-500" : "bg-slate-300 dark:bg-slate-600"
      )}
      aria-label="Toggle theme"
      role="switch"
      aria-checked={isDark}
    >
      <span
        className={cn(
          "inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform",
          isDark ? "translate-x-7" : "translate-x-1"
        )}
      >
        <span className="flex h-full w-full items-center justify-center">
          {isDark ? (
            <Moon className="h-3.5 w-3.5 text-blue-500" />
          ) : (
            <Sun className="h-3.5 w-3.5 text-amber-500" />
          )}
        </span>
      </span>
    </button>
  );
}
