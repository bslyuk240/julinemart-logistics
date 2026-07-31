import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

type ThemeToggleProps = {
  compact?: boolean;
};

export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className={
        compact
          ? 'flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
          : 'inline-flex items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
      }
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
