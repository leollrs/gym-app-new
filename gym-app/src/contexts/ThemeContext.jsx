import { createContext, useContext, useEffect, useState } from 'react';

// Theme follows the OS preference. There is intentionally no manual override
// — both `prefers-color-scheme: dark` and `light` are honored automatically
// and the user can change it in their device settings.

const ThemeContext = createContext({ isDark: false });

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    // Wipe any stale manual override that earlier builds may have written.
    try { localStorage.removeItem('theme'); } catch {}
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
