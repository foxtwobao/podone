import React, { createContext, useCallback, useContext, useState } from 'react';

interface ToastItem {
  id: number;
  message: string;
  tone: 'default' | 'success' | 'error';
}

interface ToastContextValue {
  toast: (message: string, tone?: 'default' | 'success' | 'error') => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, tone: 'default' | 'success' | 'error' = 'default') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-2), { id, message, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[90vw]">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`px-3.5 py-2.5 rounded-xl text-xs font-medium shadow-lg border transition-all ${
              item.tone === 'error'
                ? 'bg-red-600 text-white border-red-500'
                : item.tone === 'success'
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-[var(--fg)] text-[var(--bg)] border-transparent'
            }`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
