import { useTheme } from '../hooks/useTheme.js';
import { MoonIcon, SunIcon } from './icons.js';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-up-border bg-white text-up-black/70 transition-colors hover:bg-up-surface-2 dark:border-white/15 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
    >
      {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}
