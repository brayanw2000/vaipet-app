import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { User, Phone, Calendar, Loader2, ChevronLeft, ChevronDown } from 'lucide-react';

interface UserInfoStepProps {
  onNext: () => void;
  onBack?: () => void;
}

export const UserInfoStep: React.FC<UserInfoStepProps> = ({ onNext, onBack }) => {
  const { user, profile } = useAuth();
  const [phone, setPhone] = useState(profile?.phone || '');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(false);

  const formatPhone = (value: string) => {
    // Remove all non-digits
    const numbers = value.replace(/\D/g, '');
    
    // Limit to 11 digits (max for BR mobile)
    const truncated = numbers.substring(0, 11);
    
    // Apply mask (XX) XXXXX-XXXX or (XX) XXXX-XXXX
    if (truncated.length <= 2) return truncated;
    if (truncated.length <= 6) return `(${truncated.substring(0, 2)}) ${truncated.substring(2)}`;
    if (truncated.length <= 10) return `(${truncated.substring(0, 2)}) ${truncated.substring(2, 6)}-${truncated.substring(6)}`;
    return `(${truncated.substring(0, 2)}) ${truncated.substring(2, 7)}-${truncated.substring(7)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setPhone(formatted);
  };

  const validatePhone = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    // Brazil numbers have 10 or 11 digits
    return numbers.length >= 10 && numbers.length <= 11;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!day || !month || !year || !phone) {
      toast.error("Preencha todos os campos.");
      return;
    }

    if (!validatePhone(phone)) {
      toast.error("Por favor, insira um WhatsApp válido.");
      return;
    }

    const birthDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    const today = new Date();
    let ageCalc = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      ageCalc--;
    }

    if (ageCalc < 18) {
      toast.error("Você deve ter pelo menos 18 anos.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ 
          phone: phone,
          age: ageCalc,
          birthday: birthDate.toISOString().split('T')[0]
        })
        .eq('id', user?.id);

      if (error) throw error;
      onNext();
    } catch (err) {
      console.error(err);
      toast.error("Erro ao salvar dados.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-6 text-center relative">
      {onBack && (
        <button 
          onClick={onBack}
          className="absolute top-12 left-0 p-2 text-[#0B1410] hover:bg-[#0B1410]/5 rounded-full transition-colors"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}
      <div className="mb-8 p-3 bg-[#31D880]/10 rounded-2xl">
        <User className="w-8 h-8 text-[#31D880]" />
      </div>

      <h2 className="text-3xl font-bold text-[#0B1410] mb-4 font-display">
        Sobre você
      </h2>
      <p className="text-[#0B1410]/60 mb-10 max-w-[280px]">
        Confirme seus dados para personalizarmos sua experiência na VaiPet.
      </p>

      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div className="relative">
          <Phone className="absolute left-5 top-1/2 -translate-y-1/2 text-[#0B1410]/30 w-5 h-5" />
          <Input
            type="tel"
            placeholder="(00) 00000-0000"
            value={phone}
            onChange={handlePhoneChange}
            className="h-16 bg-[#0B1410]/5 text-[#0B1410] border-0 rounded-2xl pl-14 pr-6 text-lg focus:ring-1 focus:ring-[#31D880]"
            required
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="relative">
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="w-full h-16 bg-[#0B1410]/5 text-[#0B1410] border-0 rounded-2xl px-4 text-lg focus:ring-1 focus:ring-[#31D880] appearance-none"
              required
            >
              <option value="" disabled>Dia</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-[#0B1410]/30 w-4 h-4 pointer-events-none" />
          </div>

          <div className="relative">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full h-16 bg-[#0B1410]/5 text-[#0B1410] border-0 rounded-2xl px-4 text-lg focus:ring-1 focus:ring-[#31D880] appearance-none"
              required
            >
              <option value="" disabled>Mês</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-[#0B1410]/30 w-4 h-4 pointer-events-none" />
          </div>

          <div className="relative">
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full h-16 bg-[#0B1410]/5 text-[#0B1410] border-0 rounded-2xl px-4 text-lg focus:ring-1 focus:ring-[#31D880] appearance-none"
              required
            >
              <option value="" disabled>Ano</option>
              {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-[#0B1410]/30 w-4 h-4 pointer-events-none" />
          </div>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="w-full h-16 bg-[#0B1410] text-[#F7F5EF] rounded-2xl text-xl font-bold shadow-xl active:scale-95 transition-all mt-6"
        >
          {loading ? <Loader2 className="animate-spin mr-2" /> : 'Continuar'}
        </Button>
      </form>
    </div>
  );
};