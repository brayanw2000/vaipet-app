import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { SplashScreen } from '@/components/SplashScreen';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PetwalkerNavigation } from '@/components/petwalker/PetwalkerNavigation';

const PetwalkerDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [walkerProfile, setWalkerProfile] = useState<Tables<'petwalker_profiles'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [earnings, setEarnings] = useState({
    today: 0,
    pending: 0,
    available: 0,
    total: 0
  });

  const loadWalkerData = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('petwalker_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      setWalkerProfile(data);

      // Load Earnings
      const { data: earningsData } = await supabase
        .from('petwalker_earnings')
        .select('*')
        .eq('petwalker_id', user.id);

      if (earningsData) {
        const today = new Date().toISOString().split('T')[0];
        const stats = earningsData.reduce((acc, curr) => {
          const isToday = new Date(curr.created_at || '').toISOString().split('T')[0] === today;
          acc.total += Number(curr.net_amount);
          if (isToday) acc.today += Number(curr.net_amount);
          if (curr.status === 'pending') acc.pending += Number(curr.net_amount);
          if (curr.status === 'available') acc.available += Number(curr.net_amount);
          return acc;
        }, { today: 0, pending: 0, available: 0, total: 0 });
        setEarnings(stats);
      }

    } catch (err: unknown) {
      console.error('Error loading petwalker data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadWalkerData();
  }, [user, loadWalkerData]);

  const toggleAvailability = async () => {
    if (!walkerProfile || statusLoading) return;
    
    setStatusLoading(true);
    const newStatus = walkerProfile.availability_status === 'available' ? 'offline' : 'available';
    
    try {
      const { error } = await supabase.rpc('set_petwalker_availability', {
        _status: newStatus
      });

      if (error) throw error;
      
      toast.success(newStatus === 'available' ? 'Você está online!' : 'Você está offline');
      await loadWalkerData();
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || 'Erro ao alterar disponibilidade');
    } finally {
      setStatusLoading(false);
    }
  };

  if (loading) return <SplashScreen />;

  if (walkerProfile && !walkerProfile.profile_completed) {
    return <Navigate to="/petwalker/onboarding" replace />;
  }

  if (walkerProfile?.approval_status !== 'approved') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F7F5EF] text-center">
        <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mb-6 shadow-sm">
          <span className="text-4xl">⏳</span>
        </div>
        <h1 className="text-xl font-bold mb-2">Inscrição em Análise</h1>
        <p className="text-gray-500 mb-8 max-w-xs">
          {walkerProfile?.approval_status === 'rejected' 
            ? 'Sua inscrição foi recusada. Entre em contato com o suporte.' 
            : 'Seus dados estão sendo analisados pela nossa equipe. Você receberá uma notificação em breve.'}
        </p>
        <button 
          onClick={() => navigate('/inicio')}
          className="px-8 py-4 bg-white text-gray-900 rounded-2xl font-bold shadow-sm"
        >
          Voltar para Home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F5EF] pb-24">
      <div className="p-6">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Olá, {user?.user_metadata?.full_name?.split(' ')[0] || 'Passeador'}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="bg-[#31D880]/10 text-[#31D880] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                PetWalker
              </span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-full bg-gray-200 overflow-hidden border-2 border-white shadow-sm">
            {user?.user_metadata?.avatar_url && (
              <img src={user.user_metadata.avatar_url} alt="Profile" className="w-full h-full object-cover" />
            )}
          </div>
        </header>

        {/* Status Card */}
        <div className="bg-white rounded-3xl p-6 shadow-sm mb-6 border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-gray-500">Status atual</span>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${walkerProfile?.availability_status === 'available' ? 'bg-[#31D880]' : 'bg-gray-400'}`} />
              <span className="text-sm font-bold uppercase tracking-tight">
                {walkerProfile?.availability_status === 'available' ? 'Disponível' : 'Offline'}
              </span>
            </div>
          </div>
          <button 
            disabled={statusLoading}
            onClick={toggleAvailability}
            className={`w-full py-4 rounded-2xl font-bold shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${
              walkerProfile?.availability_status === 'available' 
                ? 'bg-gray-100 text-gray-600' 
                : 'bg-primary text-white shadow-primary/20'
            }`}
          >
            {statusLoading && <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            {walkerProfile?.availability_status === 'available' ? 'Ficar Offline' : 'Ficar Disponível'}
          </button>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest block mb-1">Hoje</span>
            <span className="text-xl font-bold">R$ {earnings.today.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest block mb-1">Passeios</span>
            <span className="text-xl font-bold">{walkerProfile?.completed_walks || 0}</span>
          </div>
        </div>

        {/* Section Title */}
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="font-bold">Próximas solicitações</h2>
        </div>

        {/* Requests Empty State */}
        <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm text-center mb-6">
          <div className="w-16 h-16 bg-[#F7F5EF] rounded-2xl flex items-center justify-center mx-auto mb-4">
             <span className="text-2xl">🐕</span>
          </div>
          <h3 className="font-bold mb-1">Nenhum passeio ativo</h3>
          <p className="text-sm text-gray-500">Fique disponível para começar a receber solicitações de passeio.</p>
        </div>
      </div>
      <PetwalkerNavigation />
    </div>
  );
};

export default PetwalkerDashboard;
