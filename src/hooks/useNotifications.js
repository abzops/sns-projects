import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function useNotifications(workspaceId = null) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const channelRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (workspaceId) {
        query = query.eq('workspace_id', workspaceId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setNotifications(data || []);
    } catch (err) {
      console.error('Error fetching notifications:', err);
      setError(err.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [user, workspaceId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;

    const channelName = `user-notifs-${user.id}-${workspaceId || 'all'}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newNotif = payload.new;
            if (!workspaceId || newNotif.workspace_id === workspaceId) {
              setNotifications((prev) => [newNotif, ...prev.filter((n) => n.id !== newNotif.id)]);
            }
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new;
            setNotifications((prev) =>
              prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n))
            );
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old?.id;
            if (deletedId) {
              setNotifications((prev) => prev.filter((n) => n.id !== deletedId));
            }
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user, workspaceId]);

  const markAsRead = async (id) => {
    try {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: now,
        })
        .eq('id', id);

      if (updateError) throw updateError;

      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: now } : n))
      );
    } catch (err) {
      console.error('Error marking notification as read:', err);
      throw err;
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;
    try {
      const now = new Date().toISOString();
      let query = supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: now,
        })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (workspaceId) {
        query = query.eq('workspace_id', workspaceId);
      }

      const { error: updateError } = await query;

      if (updateError) throw updateError;

      setNotifications((prev) =>
        prev.map((n) => ({ ...n, is_read: true, read_at: now }))
      );
    } catch (err) {
      console.error('Error marking all notifications as read:', err);
      throw err;
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return {
    notifications,
    unreadCount,
    loading,
    error,
    markAsRead,
    markAllAsRead,
    refetch: fetchNotifications,
  };
}
