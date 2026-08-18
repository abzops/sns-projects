import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  CheckCheck,
  Clock,
  Layers,
  BellOff,
  ExternalLink,
} from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';
import Spinner from './Spinner';
import { useToast } from './Toast';
import styles from './NotificationBell.module.css';

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotificationBell({ workspaceId }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const {
    notifications = [],
    unreadCount = 0,
    loading,
    error,
    markAsRead,
    markAllAsRead,
  } = useNotifications(workspaceId);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on ESC
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    },
    []
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const handleNotificationClick = async (notif) => {
    try {
      if (!notif.is_read) {
        await markAsRead(notif.id);
      }
      setIsOpen(false);

      // Navigate to project if available
      if (notif.project_id && notif.workspace_id) {
        navigate(`/workspace/${notif.workspace_id}/project/${notif.project_id}`);
      }
    } catch (err) {
      console.error('Error handling notification click:', err);
      showToast(err.message || 'Failed to open notification', 'error');
    }
  };

  const handleMarkAllRead = async (e) => {
    e.stopPropagation();
    try {
      await markAllAsRead();
    } catch (err) {
      console.error('Error marking all as read:', err);
      showToast(err.message || 'Failed to mark notifications as read', 'error');
    }
  };

  return (
    <div className={styles.wrapper} ref={dropdownRef}>
      <button
        type="button"
        className={`${styles.bellBtn} ${isOpen ? styles.bellActive : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Notifications (${unreadCount} unread)`}
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className={styles.badge}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className={styles.dropdown} role="dialog" aria-label="Notifications panel">
          {/* Header */}
          <div className={styles.header}>
            <div className={styles.headerTitleWrap}>
              <h4 className={styles.headerTitle}>Notifications</h4>
              {unreadCount > 0 && (
                <span className={styles.unreadCountBadge}>
                  {unreadCount} new
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                className={styles.markAllBtn}
                onClick={handleMarkAllRead}
                title="Mark all notifications as read"
              >
                <CheckCheck size={14} />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* List */}
          <div className={styles.body}>
            {loading && notifications.length === 0 ? (
              <div className={styles.centerState}>
                <Spinner size="sm" />
                <span>Loading updates…</span>
              </div>
            ) : error ? (
              <div className={styles.centerState}>
                <span className={styles.errorText}>{error}</span>
              </div>
            ) : notifications.length === 0 ? (
              <div className={styles.emptyState}>
                <BellOff size={28} className={styles.emptyIcon} />
                <strong>No notifications yet</strong>
                <p>You&apos;re completely caught up on your projects.</p>
              </div>
            ) : (
              <div className={styles.notificationList}>
                {notifications.map((notif) => {
                  const isUnread = !notif.is_read;

                  return (
                    <div
                      key={notif.id}
                      className={`${styles.item} ${isUnread ? styles.itemUnread : ''}`}
                      onClick={() => handleNotificationClick(notif)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && handleNotificationClick(notif)}
                    >
                      <div className={styles.itemLeft}>
                        {isUnread ? (
                          <span className={styles.unreadDot} title="Unread" />
                        ) : (
                          <span className={styles.readDot} />
                        )}
                      </div>

                      <div className={styles.itemContent}>
                        <div className={styles.itemTitleRow}>
                          <span className={styles.itemTitle}>{notif.title}</span>
                          <span className={styles.itemTime}>
                            <Clock size={10} />
                            {formatRelativeTime(notif.created_at)}
                          </span>
                        </div>

                        {notif.message && (
                          <p className={styles.itemMessage}>{notif.message}</p>
                        )}

                        {notif.project_id && (
                          <span className={styles.itemProjectLink}>
                            <Layers size={11} />
                            <span>View in Project</span>
                            <ExternalLink size={10} />
                          </span>
                        )}
                      </div>

                      {isUnread && (
                        <button
                          type="button"
                          className={styles.markReadBtn}
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await markAsRead(notif.id);
                            } catch (err) {
                              showToast(err.message || 'Failed to mark notification as read', 'error');
                            }
                          }}
                          title="Mark as read"
                          aria-label="Mark as read"
                        >
                          <Check size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
