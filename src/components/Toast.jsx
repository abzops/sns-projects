import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import styles from './Toast.module.css';

const ToastContext = createContext(null);

let toastIdCounter = 0;

const typeConfig = {
  success: { icon: CheckCircle2, className: 'success' },
  error:   { icon: AlertCircle,  className: 'error' },
  info:    { icon: Info,          className: 'info' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const removeToast = useCallback((id) => {
    // First trigger the exit animation
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );
    // Then remove after animation completes
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      if (timersRef.current[id]) {
        clearTimeout(timersRef.current[id]);
        delete timersRef.current[id];
      }
    }, 300);
  }, []);

  const showToast = useCallback(
    (message, type = 'info') => {
      const id = ++toastIdCounter;

      setToasts((prev) => {
        const next = [...prev, { id, message, type, exiting: false, createdAt: Date.now() }];
        // Keep max 3 visible — remove oldest
        if (next.filter((t) => !t.exiting).length > 3) {
          const oldest = next.find((t) => !t.exiting);
          if (oldest) {
            removeToast(oldest.id);
          }
        }
        return next;
      });

      // Auto-dismiss after 4s
      timersRef.current[id] = setTimeout(() => removeToast(id), 4000);

      return id;
    },
    [removeToast]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {createPortal(
        <div className={styles.container} aria-live="polite">
          {toasts.map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onClose={() => removeToast(toast.id)}
            />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }) {
  const config = typeConfig[toast.type] || typeConfig.info;
  const Icon = config.icon;

  return (
    <div
      className={`${styles.toast} ${styles[config.className]} ${
        toast.exiting ? styles.exiting : ''
      }`}
      role="alert"
    >
      <div className={styles.iconWrap}>
        <Icon size={18} />
      </div>
      <span className={styles.message}>{toast.message}</span>
      <button
        className={styles.closeBtn}
        onClick={onClose}
        type="button"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
      {!toast.exiting && <div className={styles.progress} />}
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
