import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';

const ToastContext = createContext(null);

let toastId = 0;

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const timeoutIds = useRef(new Map());

  // Clear all pending timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutIds.current.forEach((tid) => clearTimeout(tid));
      timeoutIds.current.clear();
    };
  }, []);

  // Optional 3rd arg: { action: { label, onClick }, durationMs }
  // - action renders a tappable label inside the toast (e.g. "Undo")
  // - durationMs overrides the default 3s auto-dismiss
  const showToast = useCallback((message, type = 'info', opts = null) => {
    const id = ++toastId;
    const action = opts?.action || null;
    const duration = Math.max(1000, opts?.durationMs || 3000);
    setToasts(prev => [...prev, { id, message, type, action }]);
    const tid = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timeoutIds.current.delete(id);
    }, duration);
    timeoutIds.current.set(id, tid);
  }, []);

  const dismissToast = useCallback((id) => {
    // Clear the auto-dismiss timeout when manually dismissed
    const tid = timeoutIds.current.get(id);
    if (tid) {
      clearTimeout(tid);
      timeoutIds.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toasts, showToast, dismissToast }), [toasts, showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};
