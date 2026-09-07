import React, { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { PetwalkerGpsContext, GpsStatus } from '@/contexts/PetwalkerGpsContext';

export const PetwalkerGpsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile } = useAuth();
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [status, setStatus] = useState<GpsStatus>('requesting');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isActive, setIsActive] = useState(false);

  const watchId = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const UPDATE_INTERVAL = 10000; // 10s throttle per Phase 4.2 specs

  const isPetwalker = profile?.signup_intent === 'petwalker';

  // Authority: Tracking is active when Petwalker is approved AND (available OR has active walk)
  useEffect(() => {
    if (!user || !isPetwalker) {
      setIsActive(false);
      return;
    }

    const checkActive = async () => {
      const { data } = await supabase
        .from('petwalker_profiles')
        .select('availability_status, current_walk_id, approval_status')
        .eq('user_id', user.id)
        .maybeSingle();
      
      const isApproved = data?.approval_status === 'approved';
      const isAvailable = data?.availability_status === 'available';
      const hasWalk = data?.current_walk_id !== null;
      
      setIsActive(isApproved && (isAvailable || hasWalk));
    };

    checkActive();

    // Subscribe to profile changes to toggle GPS authority
    const channel = supabase
      .channel('gps-authority-monitor')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'petwalker_profiles',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        const next = payload.new as any;
        const isApproved = next.approval_status === 'approved';
        const isAvailable = next.availability_status === 'available';
        const hasWalk = next.current_walk_id !== null;
        setIsActive(isApproved && (isAvailable || hasWalk));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isPetwalker]);

  const syncLocation = useCallback(async (lat: number, lng: number, acc: number, capturedAt: number) => {
    if (!user) return;
    const now = Date.now();
    
    // Accuracy check (> 60m is considered unstable)
    const isUnstable = acc > 60;
    
    // Frequency control
    if (now - lastUpdateRef.current < UPDATE_INTERVAL) return;

    try {
      // Hardened RPC: handles monotonicity and authority checks
      const { data, error } = await supabase.rpc('update_walker_location', {
        _lat: lat,
        _lng: lng,
        _accuracy: acc,
        _captured_at: capturedAt
      });

      // Point rejected by server (monotonicity, busy logic, etc.) OR error
      if (error || data !== true) {
        if (error) console.error('GPS Sync failed:', error);
        setStatus(error ? 'error' : 'unstable');
        return;
      }

      // Success: data === true
      setStatus(isUnstable ? 'unstable' : 'synced');
      setLastSync(new Date());
      lastUpdateRef.current = now;
    } catch (e) {
      console.error('GPS Sync exception:', e);
      setStatus('error');
    }
  }, [user]);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('error');
      return;
    }

    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy: acc } = pos.coords;
        // Use pos.timestamp as the definitive GPS capture time
        const capturedAt = pos.timestamp;
        
        setCoords([longitude, latitude]);
        setAccuracy(acc);
        syncLocation(latitude, longitude, acc, capturedAt);
      },
      (err) => {
        console.error('GPS Error:', err);
        setStatus(err.code === 1 ? 'denied' : 'error');
        if (err.code === 1) toast.error('Permissão de GPS necessária para trabalhar');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [syncLocation]);

  const stopTracking = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setStatus('requesting');
    setCoords(null);
    setAccuracy(null);
  }, []);

  useEffect(() => {
    if (isActive && user) {
      startTracking();
    } else {
      stopTracking();
    }
    return () => stopTracking();
  }, [isActive, user, startTracking, stopTracking]);

  // Stale check
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      if (lastSync && (Date.now() - lastSync.getTime() > 45000)) {
        setStatus('stale');
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [isActive, lastSync]);

  return (
    <PetwalkerGpsContext.Provider value={{ 
      coords, 
      accuracy, 
      status, 
      lastSync, 
      retry: startTracking,
      isOnline: isActive
    }}>

      {children}
    </PetwalkerGpsContext.Provider>
  );
};
