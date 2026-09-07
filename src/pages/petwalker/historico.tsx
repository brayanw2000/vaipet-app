import React, { useState, useEffect } from 'react';
import { PetwalkerProtectedRoute } from '@/components/PetwalkerProtectedRoute';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { PetwalkerNavigation } from '@/components/petwalker/PetwalkerNavigation';
import { History as HistoryIcon, Calendar } from 'lucide-react';
import { Database } from '@/integrations/supabase/types';

const PetwalkerHistorico = () => {
  const { user } = useAuth();
  const [walks, setWalks] = useState<Database['public']['Tables']['walk_sessions']['Row'][]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadHistory = async () => {
      if (!user) return;
      
      const { data, error } = await supabase
        .from('walk_sessions')
        .select('*')
        .eq('walker_id', user.id)
        .eq('current_status', 'completed')

      if (data && !error) {
        setWalks(data);
      }
      setLoading(false);
    };
    loadHistory();
  }, [user]);

  return (
    <PetwalkerProtectedRoute>
      <div className="min-h-screen bg-[#F7F5EF] pb-24">
        <Header />
        <div className="p-6 max-w-lg mx-auto">
          <h1 className="text-2xl font-bold mb-6">Histórico de Passeios</h1>

          <div className="space-y-4">
            {loading ? (
              <div className="p-8 text-center text-gray-400">Carregando histórico...</div>
            ) : walks.length === 0 ? (
              <div className="bg-white p-8 rounded-2xl text-center">
                <HistoryIcon className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500">Nenhum passeio realizado ainda.</p>
              </div>
            ) : (
              walks.map(walk => (
                <div key={walk.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <Calendar className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium">
                        {new Date(walk.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      walk.current_status === 'completed' ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'
                    }`}>
                      {walk.current_status === 'completed' ? 'Concluído' : walk.current_status}
                    </span>
                  </div>
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-xs text-gray-400">Status</p>
                      <p className="font-bold">{walk.current_status}</p>
                    </div>
                    <p className="font-bold text-primary">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(walk.distance_km) || 0)}
                    </p>
                  </div>
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

export default PetwalkerHistorico;