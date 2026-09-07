import React, { useState, useEffect } from 'react';
import { PetwalkerProtectedRoute } from '@/components/PetwalkerProtectedRoute';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { PetwalkerNavigation } from '@/components/petwalker/PetwalkerNavigation';
import { Wallet, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { Database } from '@/integrations/supabase/types';

const PetwalkerGanhos = () => {
  const { user } = useAuth();
  const [earnings, setEarnings] = useState<Database['public']['Tables']['petwalker_earnings']['Row'][]>([]);
  const [stats, setStats] = useState({
    today: 0,
    pending: 0,
    available: 0,
    total: 0
  });

  useEffect(() => {
    const loadEarnings = async () => {
      if (!user) return;
      
      const { data, error } = await supabase
        .from('petwalker_earnings')
        .select('*')
        .eq('petwalker_id', user.id)
        .order('created_at', { ascending: false });

      if (data && !error) {
        setEarnings(data);
        
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

        const today = data
          .filter(e => e.created_at >= startOfToday && e.status !== 'reversed')
          .reduce((acc, curr) => acc + Number(curr.net_amount), 0);

        const pending = data
          .filter(e => e.status === 'pending')
          .reduce((acc, curr) => acc + Number(curr.net_amount), 0);

        const available = data
          .filter(e => e.status === 'available')
          .reduce((acc, curr) => acc + Number(curr.net_amount), 0);

        const total = data
          .filter(e => e.status !== 'reversed')
          .reduce((acc, curr) => acc + Number(curr.net_amount), 0);

        setStats({ today, pending, available, total });
      }
    };
    loadEarnings();
  }, [user]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  return (
    <PetwalkerProtectedRoute>
      <div className="min-h-screen bg-[#F7F5EF] pb-24">
        <Header />
        <div className="p-6 max-w-lg mx-auto">
          <h1 className="text-2xl font-bold mb-6">Meus Ganhos</h1>

          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-white p-4 rounded-2xl shadow-sm">
              <p className="text-gray-500 text-xs mb-1">Hoje</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(stats.today)}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm">
              <p className="text-gray-500 text-xs mb-1">Disponível</p>
              <p className="text-xl font-bold text-primary">{formatCurrency(stats.available)}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm">
              <p className="text-gray-500 text-xs mb-1">Pendente</p>
              <p className="text-xl font-bold text-orange-500">{formatCurrency(stats.pending)}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm">
              <p className="text-gray-500 text-xs mb-1">Total Histórico</p>
              <p className="text-xl font-bold">{formatCurrency(stats.total)}</p>
            </div>
          </div>

          <h2 className="text-lg font-bold mb-4">Lançamentos Recentes</h2>
          <div className="space-y-3">
            {earnings.length === 0 ? (
              <div className="bg-white p-8 rounded-2xl text-center">
                <Wallet className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500">Nenhum ganho registrado ainda.</p>
              </div>
            ) : (
              earnings.map(e => (
                <div key={e.id} className="bg-white p-4 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${e.status === 'reversed' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500'}`}>
                      {e.status === 'reversed' ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownLeft className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="font-medium">{e.status === 'reversed' ? 'Estorno' : 'Passeio Concluído'}</p>
                      <p className="text-xs text-gray-400">{new Date(e.created_at).toLocaleDateString('pt-BR')}</p>
                    </div>
                  </div>
                  <p className={`font-bold ${e.status === 'reversed' ? 'text-red-500' : 'text-green-600'}`}>
                    {e.status === 'reversed' ? '-' : '+'}{formatCurrency(Number(e.net_amount))}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
        <PetwalkerNavigation />
      </div>
    </PetwalkerProtectedRoute>
  );
};

export default PetwalkerGanhos;