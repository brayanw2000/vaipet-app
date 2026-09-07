import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import logoAsset from "@/assets/vaipet-logo-new.png.asset.json";

const VaiPetLogo = () => (
  <img 
    src="/vaipet-logo.svg" 
    alt="VaiPet" 
    className="w-48 h-auto"
  />
);

interface LocationStepProps {
  onNext: (data?: {name: string, photo?: string}) => void;
}

export const LocationStep: React.FC<LocationStepProps> = ({ onNext }) => {
  const [loading, setLoading] = useState(false);
  const { user, profile } = useAuth();

  const handleActivateLocation = async () => {
    setLoading(true);
    
    try {
      if (!navigator.geolocation) {
        toast.error('Geolocalização não é suportada por este navegador.');
        setLoading(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          
          try {
            // Salvar localização no banco
            const { error } = await supabase
              .from('locations')
              .insert({
                user_id: user?.id,
                name: 'Localização atual',
                address: 'Endereço obtido por GPS',
                city: 'São Paulo',
                state: 'SP',
                postal_code: '00000-000',
                latitude: latitude,
                longitude: longitude,
                is_default: true
              });

            if (error) {
              console.error('Erro ao salvar localização:', error);
              toast.error('Erro ao salvar localização');
            } else {
              toast.success('Localização ativada com sucesso!');
              onNext();
            }
          } catch (error) {
            console.error('Erro:', error);
            toast.error('Erro ao processar localização');
          } finally {
            setLoading(false);
          }
        },
        (error) => {
          console.error('Erro de geolocalização:', error);
          toast.error('Erro ao obter localização. Verifique as permissões.');
          setLoading(false);
        }
      );
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao ativar localização');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-20 p-6 text-center bg-[#F7F5EF]">
      <div className="mb-12">
        <VaiPetLogo />
      </div>
      
      <h1 className="text-[#0B1410] text-3xl font-bold mb-4 tracking-tight font-display">
        Olá, {profile?.full_name?.split(' ')[0] || 'usuário'}
      </h1>
      
      <p className="text-[#0B1410]/70 text-base mb-12 max-w-[280px] leading-relaxed">
        Para uma melhor experiência, ative sua localização.
      </p>
      
      <Button
        onClick={handleActivateLocation}
        disabled={loading}
        className="w-full max-w-sm h-16 text-[#F7F5EF] text-xl font-bold rounded-2xl border-0 mb-8 hover:opacity-90 active:scale-[0.98] transition-all font-display shadow-lg shadow-[#0B1410]/10"
        style={{ backgroundColor: '#0B1410' }}
      >
        {loading ? 'Ativando...' : 'Ativar localização'}
      </Button>
      
      <p className="text-[#0B1410]/40 text-sm font-medium uppercase tracking-wider">
        Precisa de ajuda?
      </p>
    </div>
  );
};