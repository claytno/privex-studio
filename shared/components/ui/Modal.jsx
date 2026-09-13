import { motion as Motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

const openDialogs = [];
const originalInert = new Map();
let originalOverflow;

function isolateTopDialog() {
  const top = openDialogs.at(-1);
  if (!top) {
    for (const [element, inert] of originalInert) element.inert = inert;
    originalInert.clear();
    document.body.style.overflow = originalOverflow ?? '';
    return;
  }
  for (const element of document.body.children) {
    if (!originalInert.has(element)) originalInert.set(element, element.inert);
    element.inert = element !== top.parentElement;
  }
}

export default function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  const panel = useRef(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const titleId = useId();
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    const node = panel.current;
    if (!node) return;
    if (!openDialogs.length) { originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    openDialogs.push(node);
    isolateTopDialog();
    const focusable = () => [...(node?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') || [])].filter((el) => el.getClientRects().length && !el.matches(':disabled') && !el.closest('[inert]') && el.tabIndex >= 0);
    (focusable()[0] || node)?.focus();
    const keydown = (event) => {
      if (openDialogs.at(-1) !== node || node.closest('[inert]')) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current?.(); }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0]; const last = elements.at(-1);
      if (!first) { event.preventDefault(); node?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node || !node.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !node?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event) => {
      if (openDialogs.at(-1) === node && !node.closest('[inert]') && !node.contains(event.target)) (focusable()[0] || node).focus();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
      const wasTop = openDialogs.at(-1) === node;
      const index = openDialogs.indexOf(node);
      if (index >= 0) openDialogs.splice(index, 1);
      isolateTopDialog();
      if (wasTop && previous?.isConnected && !previous.closest('[inert]')) previous.focus();
    };
  }, [isOpen]);
  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-full',
  };

  return createPortal(
    isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <Motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : 'Diálogo'}
            tabIndex={-1}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={`relative flex min-w-0 flex-col bg-px-card border border-px-border rounded-2xl w-full ${sizeClasses[size]} max-h-[90dvh] overflow-hidden`}
          >
            {title && (
              <div className="flex shrink-0 items-start justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-px-border">
                <h2 id={titleId} className="min-w-0 flex-1 max-h-[35dvh] overflow-y-auto overscroll-contain [overflow-wrap:anywhere] py-2 text-lg font-semibold font-display">{title}</h2>
                <button type="button" aria-label="Fechar" onClick={onClose} className="p-2 min-w-11 min-h-11 shrink-0 flex items-center justify-center rounded-lg hover:bg-px-elevated text-px-muted hover:text-px-text transition-colors cursor-pointer">
                  <X size={20} />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
              {children}
            </div>
          </Motion.div>
        </div>
    ) : null,
    document.body
  );
}
