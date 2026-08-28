import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import styles from './FinancialDetailPopover.module.css';

/**
 * FinancialDetailPopover
 *
 * Reusable, accessible financial context card / popover for hierarchy indicators.
 * Manages hover preview, click pinning, keyboard navigation (Enter/Space/Escape),
 * focus restoration, portal rendering, viewport boundary clamping, and scope-switch safety.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.trigger - Trigger element/pill to render
 * @param {React.ReactNode} props.content - Detail card content
 * @param {string} [props.title='Financial Details'] - Accessible dialog title
 * @param {string} [props.className] - Additional trigger container class
 * @param {any} [props.scopeKey] - Key representing active scope (closes popover on change)
 */
export default function FinancialDetailPopover({
  trigger,
  content,
  title = 'Financial Details',
  className = '',
  scopeKey,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, placement: 'bottom' });
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const hoverTimeoutRef = useRef(null);
  const popoverId = useId();

  // Close immediately if scopeKey changes (Project, Workspace, Scope switch)
  useEffect(() => {
    setIsOpen(false);
    setIsPinned(false);
  }, [scopeKey]);

  // Compute position relative to viewport with boundary clamping and flip detection
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popoverWidth = Math.min(340, viewportWidth - 24);
    const estimatedHeight = 280;

    let top = rect.bottom + 6;
    let placement = 'bottom';

    // Flip above if not enough room below
    if (rect.bottom + estimatedHeight > viewportHeight - 12 && rect.top - estimatedHeight > 12) {
      top = rect.top - estimatedHeight - 6;
      placement = 'top';
    }

    // Horizontal alignment and viewport clamping
    let left = rect.left;
    if (left + popoverWidth > viewportWidth - 12) {
      left = Math.max(12, viewportWidth - popoverWidth - 12);
    }
    if (left < 12) {
      left = 12;
    }

    setCoords({ top, left, placement });
  }, []);

  // Update position when open and listen to scroll/resize
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, updatePosition]);

  // Outside pointer click & Escape key listener
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e) => {
      if (
        triggerRef.current?.contains(e.target) ||
        popoverRef.current?.contains(e.target)
      ) {
        return;
      }
      setIsOpen(false);
      setIsPinned(false);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        setIsPinned(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setIsOpen(true);
    }, 120);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (!isPinned) {
      hoverTimeoutRef.current = setTimeout(() => {
        setIsOpen(false);
      }, 150);
    }
  };

  const handleClick = (e) => {
    e.stopPropagation();
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (isOpen && isPinned) {
      setIsOpen(false);
      setIsPinned(false);
    } else {
      setIsOpen(true);
      setIsPinned(true);
    }
  };

  const handleTriggerKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) {
        setIsOpen(false);
        setIsPinned(false);
      } else {
        setIsOpen(true);
        setIsPinned(true);
      }
    }
  };

  return (
    <div
      className={`${styles.popoverWrapper} ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.triggerButton} ${isOpen ? styles.triggerActive : ''}`}
        onClick={handleClick}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        aria-label={`${title}. Click or press Enter to view financial details.`}
      >
        {trigger}
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            aria-label={title}
            className={`${styles.popoverCard} ${styles[`placement_${coords.placement}`]} ${
              isPinned ? styles.pinned : ''
            }`}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </div>,
          document.body
        )}
    </div>
  );
}
