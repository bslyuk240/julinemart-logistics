import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

/** Matches NotificationsPanel bell button sizing in the header. */
export function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className="relative inline-flex shrink-0 items-center justify-center rounded-lg p-2 text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-white"
    >
      {isDark ? (
        <Sun className="h-6 w-6" strokeWidth={2} />
      ) : (
        <Moon className="h-6 w-6" strokeWidth={2} />
      )}
    </button>
  );
}
