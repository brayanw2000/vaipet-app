import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ChevronLeft, RefreshCw, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tables } from '@/integrations/supabase/types';

const PetwalkerInscricao = () => {
  const navigate = useNavigate();
  const { user, profile, hasRole, applicationStatus, petwalkerApplication, refreshApplication, refreshRoles, refreshProfile, signOut, authStatus } = useAuth();
  const [loading, setLoading] = useState(false);
  
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    legal_name: '',
    birth_date: '',
    phone: '',
    city: '',
    experience_description: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  });

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      navigate('/auth?redirect=/petwalker/inscricao', { replace: true });
      return;
    }
    if (hasRole('petwalker')) {
      navigate('/petwalker', { replace: true });
    }
  }, [hasRole, navigate, authStatus]);

  const validateAge = (dateString: string) => {
    const today = new Date();
    const birthDate = new Date(dateString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age >= 18;
  };

  const handleUpdateStatus = async () => {
    setLoading(true);
    await refreshApplication();
    await refreshRoles();
    setLoading(false);
  };

  const handleContinueAsOwner = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.rpc('set_signup_intent', { _intent: 'pet_owner' });
      if (error) throw error;
      await refreshProfile();
      toast.success('Alterado para Dono(a) de Pet com sucesso!');
      navigate('/inicio');
    } catch (err) {
      toast.error('Erro ao alterar intenção');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate('/auth?redirect=/petwalker/inscricao');
      return;
    }

    if (!validateAge(formData.birth_date)) {
      toast.error('Você deve ter pelo menos 18 anos para se inscrever.');
      return;
    }

    setLoading(true);
    try {
      // Set signup intent first to ensure the user is registered as interested in petwalking
      await supabase.rpc('set_signup_intent', { _intent: 'petwalker' });
      
      const { error } = await supabase.from('petwalker_applications').insert([
        {
          user_id: user.id,
          legal_name: formData.legal_name,
          birth_date: formData.birth_date,
          phone: formData.phone,
          city: formData.city,
          experience_description: formData.experience_description,
          emergency_contact_name: formData.emergency_contact_name,
          emergency_contact_phone: formData.emergency_contact_phone,
          status: 'pending'
        },
      ]);

      if (error) throw error;

      toast.success('Inscrição enviada com sucesso!');
      await refreshApplication();
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || 'Erro ao processar inscrição');
    } finally {
      setLoading(false);
    }
  };

  if (authStatus === 'initializing' || applicationStatus === 'loading' || applicationStatus === 'idle') {
    return (
      <div className="min-h-screen bg-[#F7F5EF] flex items-center justify-center p-6 text-center">
         <div className="animate-pulse flex flex-col items-center">
           <div className="w-12 h-12 bg-gray-200 rounded-full mb-4"></div>
           <div className="h-4 w-32 bg-gray-200 rounded"></div>
         </div>
      </div>
    );
  }

  if (applicationStatus === 'pending') {
    return (
      <div className="min-h-screen bg-[#F7F5EF] flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-sm">
          <div className="w-20 h-20 bg-[#FFF5F0] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl text-[#F14A00]">⏳</span>
          </div>
          <h1 className="text-2xl font-bold mb-2">Em Análise</h1>
          <p className="text-gray-500 mb-8">
            Sua candidatura está sendo revisada por nossa equipe. 
            Isso geralmente leva de 24h a 48h úteis.
          </p>
          <div className="flex flex-col gap-3">
            <Button onClick={handleUpdateStatus} disabled={loading} className="w-full h-14 rounded-2xl font-bold flex gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar Status
            </Button>
            <Button variant="ghost" onClick={signOut} className="w-full h-14 rounded-2xl font-bold flex gap-2">
              <LogOut className="w-4 h-4" />
              Sair
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (applicationStatus === 'rejected') {
    return (
      <div className="min-h-screen bg-[#F7F5EF] flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-sm">
          <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl">❌</span>
          </div>
          <h1 className="text-2xl font-bold mb-2">Candidatura Rejeitada</h1>
          <p className="text-red-500 text-sm mb-4">
            Motivo: {petwalkerApplication?.rejection_reason || 'Não informado.'}
          </p>
          <p className="text-gray-500 mb-8">
            Infelizmente sua candidatura não foi aprovada neste momento. 
            Você ainda pode usar o VaiPet como Dono(a) de Pet.
          </p>
          <div className="flex flex-col gap-3">
            <Button onClick={handleContinueAsOwner} disabled={loading} className="w-full h-14 rounded-2xl font-bold">
              Continuar como Dono(a) de Pet
            </Button>
            <Button variant="ghost" onClick={signOut} className="w-full h-14 rounded-2xl font-bold">
              Sair
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F5EF] pb-10">
      <div className="max-w-md mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <button 
            onClick={() => {
              if (step > 1) setStep(step - 1);
              else navigate('/inicio');
            }} 
            className="flex items-center gap-2 text-gray-500 font-medium text-sm"
          >
            <ChevronLeft size={18} />
            {step === 1 ? 'Continuar depois' : 'Voltar'}
          </button>
          <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">
            Etapa {step} de 2
          </span>
        </div>

        <h1 className="text-2xl font-bold mb-1">Seja um PetWalker</h1>
        <p className="text-sm text-gray-500 mb-8">
          {step === 1 ? 'Dados pessoais para sua identificação.' : 'Experiência e contatos de segurança.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <label className="text-sm font-bold ml-1">Nome Completo (Conforme documento)</label>
                  <Input 
                    required 
                    className="h-14 rounded-2xl bg-[#F2F2F7] border-none shadow-none focus:bg-[#E5E5EA] transition-colors"
                    value={formData.legal_name}
                    onChange={e => setFormData({...formData, legal_name: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold ml-1">Data de Nascimento</label>
                  <Input 
                    required 
                    type="date"
                    className="h-14 rounded-2xl bg-[#F2F2F7] border-none shadow-none focus:bg-[#E5E5EA] transition-colors"
                    value={formData.birth_date}
                    onChange={e => setFormData({...formData, birth_date: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold ml-1">Telefone WhatsApp</label>
                  <Input 
                    required 
                    placeholder="(00) 00000-0000"
                    className="h-14 rounded-2xl bg-[#F2F2F7] border-none shadow-none focus:bg-[#E5E5EA] transition-colors"
                    value={formData.phone}
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold ml-1">Cidade</label>
                  <Input 
                    required 
                    className="h-14 rounded-2xl bg-[#F2F2F7] border-none shadow-none focus:bg-[#E5E5EA] transition-colors"
                    value={formData.city}
                    onChange={e => setFormData({...formData, city: e.target.value})}
                  />
                </div>

                <Button 
                  type="button"
                  onClick={() => {
                    if (formData.legal_name && formData.birth_date && formData.phone && formData.city) {
                      setStep(2);
                    } else {
                      toast.error('Preencha todos os campos obrigatórios');
                    }
                  }}
                  className="w-full h-16 rounded-2xl text-lg font-bold shadow-xl shadow-primary/20"
                >
                  Próxima Etapa
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <label className="text-sm font-bold ml-1">Sua Experiência</label>
                  <Textarea 
                    required 
                    placeholder="Descreva brevemente seu contato anterior com animais..."
                    className="min-h-[120px] rounded-2xl bg-[#F2F2F7] border-none shadow-none focus:bg-[#E5E5EA] transition-colors p-4"
                    value={formData.experience_description}
                    onChange={e => setFormData({...formData, experience_description: e.target.value})}
                  />
                </div>

                <div className="pt-4 border-t border-gray-200">
                  <h3 className="font-bold mb-4">Contato de Emergência</h3>
                  <div className="space-y-4">
                    <Input 
                      required 
                      placeholder="Nome do contato"
                      className="h-14 rounded-2xl bg-[#F2F2F7] border-none shadow-none focus:bg-[#E5E5EA] transition-colors"
                      value={formData.emergency_contact_name}
                      onChange={e => setFormData({...formData, emergency_contact_name: e.target.value})}
                    />
                    <Input 
                      required 
                      placeholder="Telefone do contato"
                      className="h-14 rounded-2xl bg-[#F2F2F7] border-none shadow-none focus:bg-[#E5E5EA] transition-colors"
                      value={formData.emergency_contact_phone}
                      onChange={e => setFormData({...formData, emergency_contact_phone: e.target.value})}
                    />
                  </div>
                </div>

                <Button 
                  disabled={loading}
                  type="submit" 
                  className="w-full h-16 rounded-2xl text-lg font-bold shadow-xl shadow-primary/20"
                >
                  {loading ? 'Processando...' : 'Enviar candidatura'}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </div>
    </div>
  );
};

export default PetwalkerInscricao;