import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PawPrint, Plus, TrendingUp, Clock, MapPin, Stethoscope, Syringe, FileText, ShoppingBag, Package, DollarSign, Hotel, Calendar, Heart } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface Pet {
  id: string;
  name: string;
  breed: string;
  age?: number;
  avatar_url?: string;
}

interface WalkSession {
  id: string;
  start_time: string;
  planned_duration_minutes: number;
  actual_duration_minutes: number | null;
  distance_km: number | null;
  current_status: string;
  walker_name: string | null;
  pets: { name: string; avatar_url: string | null } | null;
}

interface MyPetsProps {
  activeCategory?: string;
}

export const MyPets = ({ activeCategory = 'Passeios' }: MyPetsProps = {}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pets, setPets] = useState<Pet[]>([]);
  const [walks, setWalks] = useState<WalkSession[]>([]);
  const [totalWalks, setTotalWalks] = useState(0);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [totalKm, setTotalKm] = useState(0);

  useEffect(() => {
    if (user) {
      fetchPets();
      fetchWalkStats();
    }
  }, [user]);

  const fetchPets = async () => {
    try {
      const { data, error } = await supabase
        .from('pets')
        .select('id, name, breed, age, avatar_url')
        .eq('owner_id', user?.id)
        .eq('is_active', true);
      if (error) throw error;
      setPets(data || []);
    } catch (error) {
      console.error('Error fetching pets:', error);
    }
  };

  const fetchWalkStats = async () => {
    try {
      const { data, error } = await supabase
        .from('walk_sessions')
        .select('id, start_time, planned_duration_minutes, actual_duration_minutes, distance_km, current_status, walker_name, pets(name, avatar_url)')
        .eq('customer_id', user?.id)
        .eq('current_status', 'completed')
        .order('start_time', { ascending: false })
        .limit(10);
      
      if (!error && data) {
        setWalks(data);
        setTotalWalks(data.length);
        setTotalMinutes(data.reduce((acc, w) => acc + (w.actual_duration_minutes || w.planned_duration_minutes), 0));
        setTotalKm(data.reduce((acc, w) => acc + (Number(w.distance_km) || 0), 0));
      }
    } catch (error) {
      console.error('Error fetching walks:', error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const kpisByCategory: Record<string, { label: string; value: string; icon: any; color: string; bg: string }[]> = {
    Passeios: [
      { label: 'Passeios', value: totalWalks.toString(), icon: PawPrint, color: '#F14A00', bg: '#FFF5F0' },
      { label: 'Minutos', value: totalMinutes.toString(), icon: Clock, color: '#0B1410', bg: '#F3EEF8' },
      { label: 'Km', value: totalKm.toFixed(1), icon: MapPin, color: '#664898', bg: '#F5F0FA' },
    ],
    Veterinário: [
      { label: 'Consultas', value: '0', icon: Stethoscope, color: '#31d880', bg: '#E6F7F1' },
      { label: 'Vacinas', value: '0', icon: Syringe, color: '#0B1410', bg: '#F3EEF8' },
      { label: 'Exames', value: '0', icon: FileText, color: '#664898', bg: '#F5F0FA' },
    ],
    PetShop: [
      { label: 'Pedidos', value: '0', icon: ShoppingBag, color: '#F14A00', bg: '#FFF5F0' },
      { label: 'Itens', value: '0', icon: Package, color: '#0B1410', bg: '#F3EEF8' },
      { label: 'Gasto R$', value: '0', icon: DollarSign, color: '#31d880', bg: '#E6F7F1' },
    ],
    Hotéis: [
      { label: 'Estadias', value: '0', icon: Hotel, color: '#664898', bg: '#F5F0FA' },
      { label: 'Diárias', value: '0', icon: Calendar, color: '#F14A00', bg: '#FFF5F0' },
      { label: 'Pets', value: pets.length.toString(), icon: Heart, color: '#0B1410', bg: '#F3EEF8' },
    ],
  };
  const kpis = kpisByCategory[activeCategory] || kpisByCategory.Passeios;

  return (
    <div className="px-5 mb-5">
      {/* KPI Stats */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Resumo</h2>
        <TrendingUp className="w-4 h-4 text-muted-foreground/50" />
      </div>

      <div className="grid grid-cols-3 gap-2.5 mb-6">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <div key={i} className="bg-card rounded-2xl p-3.5 border border-border/40 flex flex-col items-center text-center gap-1.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: kpi.bg }}>
                <Icon className="w-4 h-4" style={{ color: kpi.color }} strokeWidth={2} />
              </div>
              <span className="text-lg font-extrabold text-foreground leading-none">{kpi.value}</span>
              <span className="text-[10px] font-semibold text-muted-foreground">{kpi.label}</span>
            </div>
          );
        })}
      </div>

      {/* Pets horizontal */}
      {pets.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Meus Pets</h2>
            <button 
              onClick={() => navigate('/add-pet')}
              className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{ backgroundColor: '#FFF5F0' }}
            >
              <Plus className="w-3.5 h-3.5" style={{ color: '#F14A00' }} strokeWidth={2.5} />
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1 mb-6">
            {pets.map((pet) => (
              <div
                key={pet.id}
                onClick={() => navigate(`/pet/${pet.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`)}
                className="flex-shrink-0 flex flex-col items-center gap-1.5 cursor-pointer active:scale-95 transition-transform"
              >
                <div className="w-16 h-16 rounded-full overflow-hidden bg-secondary ring-2 ring-border/50">
                  {pet.avatar_url ? (
                    <img src={pet.avatar_url} alt={pet.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-base font-extrabold text-muted-foreground">
                      {pet.name.charAt(0)}
                    </div>
                  )}
                </div>
                <span className="text-[11px] font-semibold text-foreground max-w-[64px] truncate">{pet.name}</span>
              </div>
            ))}
            <button
              onClick={() => navigate('/add-pet')}
              className="flex-shrink-0 flex flex-col items-center gap-1.5 active:scale-95 transition-transform"
            >
              <div className="w-16 h-16 rounded-full border-2 border-dashed flex items-center justify-center" style={{ borderColor: '#F14A00' }}>
                <Plus className="w-5 h-5" style={{ color: '#F14A00' }} />
              </div>
              <span className="text-[11px] font-semibold text-muted-foreground">Novo</span>
            </button>
          </div>
        </>
      )}

      {pets.length === 0 && (
        <button
          onClick={() => navigate('/add-pet')}
          className="w-full bg-card rounded-2xl p-5 flex items-center gap-4 mb-6 active:scale-[0.98] transition-all border border-border/50"
        >
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: '#F3EEF8' }}>
            <PawPrint className="w-6 h-6" style={{ color: '#664898' }} />
          </div>
          <div className="text-left">
            <p className="font-bold text-foreground text-sm">Adicione seu pet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Toque para cadastrar 🐾</p>
          </div>
        </button>
      )}

      {/* Recent History */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Últimos passeios</h2>
        {walks.length > 0 && (
          <button className="text-xs font-semibold" style={{ color: '#F14A00' }}>Ver tudo</button>
        )}
      </div>

      {walks.length === 0 ? (
        <div className="text-center py-8 bg-card rounded-2xl border border-border/40">
          <div className="w-12 h-12 rounded-full mx-auto mb-2.5 flex items-center justify-center" style={{ backgroundColor: '#F3EEF8' }}>
            <Clock className="w-5 h-5" style={{ color: '#664898' }} />
          </div>
          <p className="text-xs font-semibold text-muted-foreground">Nenhum passeio ainda</p>
          <p className="text-[11px] text-muted-foreground/50 mt-0.5">Agende seu primeiro passeio!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {walks.slice(0, 5).map((walk) => (
            <div key={walk.id} className="flex items-center gap-3 p-3 bg-card rounded-xl border border-border/40">
              <div className="w-9 h-9 rounded-full overflow-hidden bg-secondary flex-shrink-0">
                {walk.pets?.avatar_url ? (
                  <img src={walk.pets.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <PawPrint className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-foreground truncate">{walk.pets?.name || 'Passeio'}</p>
                <p className="text-[11px] text-muted-foreground">
                  {walk.actual_duration_minutes || walk.planned_duration_minutes} min
                  {walk.distance_km ? ` • ${Number(walk.distance_km).toFixed(1)} km` : ''}
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground font-medium">{formatDate(walk.start_time)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
