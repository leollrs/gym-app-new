import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext({ isDark: false });

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  );

  // Listen for system theme changes — always follow system preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Sync the html class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    // Clear any stale manual override from localStorage
    localStorage.removeItem('theme');
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
