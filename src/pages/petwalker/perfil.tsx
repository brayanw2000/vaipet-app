import React, { useState, useEffect } from 'react';
import { PetwalkerProtectedRoute } from '@/components/PetwalkerProtectedRoute';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { PetwalkerNavigation } from '@/components/petwalker/PetwalkerNavigation';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PetwalkerPerfil = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    public_bio: '',
    experience_years: 0,
  });

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      const { data, error } = await supabase
        .from('petwalker_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();
      
      if (data && !error) {
        setFormData({
          public_bio: data.public_bio || '',
          experience_years: data.experience_years || 0,
        });
      }
    };
    loadProfile();
  }, [user]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.rpc('update_petwalker_operational_profile', {
        _public_bio: formData.public_bio,
        _experience_years: formData.experience_years
      });

      if (error) throw error;
      toast.success('Perfil atualizado com sucesso!');
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || 'Erro ao atualizar perfil');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success('Você saiu da conta.');
      navigate('/auth', { replace: true });
    } catch {
      toast.error('Erro ao sair da conta');
    }
  };

  return (
    <PetwalkerProtectedRoute>
      <div className="min-h-screen bg-[#F7F5EF] pb-24">
        <Header />
        <div className="p-6 max-w-lg mx-auto">
          <h1 className="text-2xl font-bold mb-6">Configurações do Perfil</h1>
          
          <form onSubmit={handleUpdate} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Bio Pública</label>
              <Textarea 
                value={formData.public_bio}
                onChange={e => setFormData(prev => ({ ...prev, public_bio: e.target.value }))}
                placeholder="Conte sobre sua experiência com pets..."
                className="h-32"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Anos de Experiência</label>
                <Input 
                  type="number"
                  value={formData.experience_years}
                  onChange={e => setFormData(prev => ({ ...prev, experience_years: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>

            <Button type="submit" className="w-full h-12" disabled={loading}>
              {loading ? 'Salvando...' : 'Salvar Alterações'}
            </Button>
          </form>

          <div className="mt-10 pt-6 border-t border-separator">
            <Button
              type="button"
              variant="outline"
              onClick={handleSignOut}
              className="w-full h-12 gap-2 text-destructive border-none bg-[#F2F2F7]"
            >
              <LogOut className="w-4 h-4" />
              Sair da conta
            </Button>
          </div>
        </div>
        <PetwalkerNavigation />
      </div>
    </PetwalkerProtectedRoute>
  );
};

export default PetwalkerPerfil;