import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ChevronLeft } from 'lucide-react';

const PetwalkerOnboarding = () => {
  const navigate = useNavigate();
  const { user, authStatus } = useAuth();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [formData, setFormData] = useState({
    public_bio: '',
    experience_years: 0,
  });

  const loadProfile = useCallback(async () => {
    if (!user) return;
    setStatus('loading');
    setErrorMessage('');
    try {
      const { data, error } = await supabase
        .from('petwalker_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (error) throw error;
      
      if (data) {
        // If profile is already completed and approved, don't stay here
        if (data.profile_completed && data.approval_status === 'approved') {
          navigate('/petwalker', { replace: true });
          return;
        }

        setFormData({
          public_bio: data.public_bio || '',
          experience_years: data.experience_years || 0,
        });
        setStatus('ready');
      } else {
        setStatus('error');
        setErrorMessage('Perfil de PetWalker não encontrado. Entre em contato com o suporte.');
      }
    } catch (err) {
      console.error('Error loading profile:', err);
      setStatus('error');
      setErrorMessage('Erro ao carregar dados do perfil. Tente novamente.');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      navigate(`/auth?redirect=${encodeURIComponent('/petwalker/onboarding')}`, { replace: true });
      return;
    }

    if (authStatus === 'authenticated' && user) {
      loadProfile();
    }
  }, [user, authStatus, navigate, loadProfile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    
    setLoading(true);
    try {
      const { error } = await supabase.rpc('update_petwalker_operational_profile', {
        _public_bio: formData.public_bio,
        _experience_years: formData.experience_years
      });

      if (error) throw error;

      // Verify success by fetching the profile again
      const { data: verifyData, error: verifyError } = await supabase
        .from('petwalker_profiles')
        .select('profile_completed, approval_status')
        .eq('user_id', user?.id)
        .single();

      if (verifyError) throw new Error('Falha ao verificar atualização do perfil');

      if (verifyData.profile_completed && verifyData.approval_status === 'approved') {
        toast.success('Perfil atualizado com sucesso!');
        navigate('/petwalker', { replace: true });
      } else {
        throw new Error('O perfil não foi marcado como concluído. Tente salvar novamente.');
      }
    } catch (err: unknown) {
      console.error('Submit error:', err);
      let msg = 'Erro ao atualizar perfil';
      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === 'object' && err !== null) {
        const errorObj = err as Record<string, unknown>;
        if (typeof errorObj.details === 'string') msg = errorObj.details;
        else if (typeof errorObj.message === 'string') msg = errorObj.message;
      }
      
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F5EF]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 font-medium">Carregando dados...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F5EF] p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <p className="text-red-500 font-medium">{errorMessage}</p>
          <Button onClick={loadProfile}>Tentar novamente</Button>
          <Button variant="ghost" onClick={() => navigate('/inicio')}>Voltar para o início</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F5EF] pb-10">
      <div className="max-w-md mx-auto p-6">
        <button 
          onClick={() => navigate('/inicio', { replace: true })} 
          className="mb-6 flex items-center gap-2 text-gray-500 font-medium hover:text-gray-700 transition-colors"
        >
          <ChevronLeft size={20} />
          Voltar para o início
        </button>

        <h1 className="text-2xl font-bold mb-2">Completar Perfil</h1>
        <p className="text-gray-500 mb-8">Dados necessários para começar a receber passeios.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Bio Pública</label>
            <Textarea 
              required 
              placeholder="Descreva seu trabalho..."
              className="min-h-[120px] rounded-2xl bg-white border-none shadow-sm p-4"
              value={formData.public_bio}
              onChange={e => setFormData({...formData, public_bio: e.target.value})}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-bold ml-1">Anos de Exp.</label>
              <Input 
                required 
                type="number"
                min="0"
                className="h-14 rounded-2xl bg-white border-none shadow-sm"
                value={formData.experience_years}
                onChange={e => setFormData({...formData, experience_years: parseInt(e.target.value) || 0})}
                disabled={loading}
              />
            </div>
          </div>

          <Button 
            disabled={loading}
            type="submit" 
            className="w-full h-16 rounded-2xl text-lg font-bold shadow-xl shadow-primary/20"
          >
            {loading ? 'Salvando...' : 'Salvar Perfil'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default PetwalkerOnboarding;
