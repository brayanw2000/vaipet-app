import React, { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Bell, Check, Trash2, Dog, ShoppingBag, Stethoscope, Hotel, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
  data: any;
}

const typeIcons: Record<string, React.ReactNode> = {
  walk: <Dog className="w-4 h-4" />,
  petshop: <ShoppingBag className="w-4 h-4" />,
  vet: <Stethoscope className="w-4 h-4" />,
  hotel: <Hotel className="w-4 h-4" />,
  info: <Info className="w-4 h-4" />,
};

const typeColors: Record<string, string> = {
  walk: '#F14A00',
  petshop: '#7C3AED',
  vet: '#059669',
  hotel: '#2563EB',
  info: '#6B7280',
};

export const NotificationSheet = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const fetchNotifications = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      setNotifications(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open && user) {
      fetchNotifications();
    }
  }, [open, user]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;

    // Initial fetch
    fetchNotifications();

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const markAsRead = async (id: string) => {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id);
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, is_read: true } : n))
    );
  };

  const markAllAsRead = async () => {
    if (!user) return;
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const deleteNotification = async (id: string) => {
    await supabase.from('notifications').delete().eq('id', id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="relative w-10 h-10 rounded-full bg-card border border-border/60 flex items-center justify-center active:scale-90 transition-transform">
          <Bell className="w-[18px] h-[18px] text-foreground" strokeWidth={1.8} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md p-0">
        <SheetHeader className="px-5 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-bold">Notificações</SheetTitle>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs font-semibold text-primary flex items-center gap-1 active:scale-95 transition-transform"
              >
                <Check className="w-3.5 h-3.5" />
                Marcar todas como lidas
              </button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-3" style={{ maxHeight: 'calc(100vh - 100px)' }}>
          {loading ? (
            <div className="flex flex-col gap-3 py-8">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Bell className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">Nenhuma notificação</p>
              <p className="text-xs text-muted-foreground">
                Você será notificado sobre passeios, promoções e mais.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="flex gap-3 p-3 rounded-xl transition-colors"
                  style={{
                    backgroundColor: notification.is_read ? 'transparent' : 'hsl(var(--accent) / 0.4)',
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{
                      backgroundColor: `${typeColors[notification.type] || typeColors.info}15`,
                      color: typeColors[notification.type] || typeColors.info,
                    }}
                  >
                    {typeIcons[notification.type] || typeIcons.info}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground leading-tight">
                        {notification.title}
                      </p>
                      <button
                        onClick={() => deleteNotification(notification.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {notification.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] text-muted-foreground/70">
                        {formatDistanceToNow(new Date(notification.created_at), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                      {!notification.is_read && (
                        <button
                          onClick={() => markAsRead(notification.id)}
                          className="text-[10px] font-semibold text-primary active:scale-95 transition-transform"
                        >
                          Marcar como lida
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
