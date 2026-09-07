import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Camera, User } from 'lucide-react';

import logoAsset from "@/assets/vaipet-logo-new.png.asset.json";

const VaiPetLogo = () => (
  <img 
    src="/vaipet-logo.svg" 
    alt="VaiPet" 
    className="w-48 h-auto"
  />
);

interface ProfilePhotoStepProps {
  onNext: () => void;
}

export const ProfilePhotoStep: React.FC<ProfilePhotoStepProps> = ({ onNext }) => {
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [fullName, setFullName] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, profile } = useAuth();

  React.useEffect(() => {
    if (profile?.full_name) {
      setFullName(profile.full_name);
    }
  }, [profile]);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('A imagem deve ter no máximo 5MB');
        return;
      }
      setPhoto(file);
      const reader = new FileReader();
      reader.onload = (ev) => setPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!user) return;
    setUploading(true);

    try {
      let avatarUrl: string | null = null;

      if (photo) {
        const fileExt = photo.name.split('.').pop();
        const fileName = `${user.id}/avatars/${Date.now()}.${fileExt}`;
        const { data, error } = await supabase.storage
          .from('pet-photos')
          .upload(fileName, photo, { cacheControl: '3600', upsert: true });

        if (!error && data) {
          const { data: { publicUrl } } = supabase.storage
            .from('pet-photos')
            .getPublicUrl(data.path);
          avatarUrl = publicUrl;
        }
      }

      const updateData: any = {};
      if (fullName) updateData.full_name = fullName;
      if (avatarUrl) updateData.avatar_url = avatarUrl;
      updateData.updated_at = new Date().toISOString();

      if (Object.keys(updateData).length > 1) {
        await supabase.from('profiles').update(updateData).eq('id', user.id);
      }

      if (fullName && fullName !== user.user_metadata?.full_name) {
        await supabase.auth.updateUser({ data: { full_name: fullName } });
      }

      onNext();
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao salvar dados');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-20 p-6 text-center bg-[#F7F5EF]">
      <div className="mb-12">
        <VaiPetLogo />
      </div>

      <h1 className="text-[#0B1410] text-3xl font-bold mb-3 tracking-tight font-display">
        Perfil
      </h1>
      <p className="text-[#0B1410]/60 text-base mb-10 max-w-[280px] mx-auto leading-relaxed">
        Adicione sua foto de perfil e confirme seu nome para começar.
      </p>

      {/* Avatar */}
      <div className="relative mb-4 group">
        <div
          className="w-32 h-32 rounded-full overflow-hidden border-[3px] border-[#31D880] bg-[#0B1410]/5 flex items-center justify-center cursor-pointer transition-transform active:scale-95 shadow-sm"
          onClick={() => fileInputRef.current?.click()}
        >
          {preview ? (
            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
          ) : (
            <User className="w-14 h-14 text-[#0B1410]/20" strokeWidth={1.5} />
          )}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="absolute bottom-0 right-0 w-10 h-10 rounded-full flex items-center justify-center shadow-lg border-4 border-[#F7F5EF] active:scale-90 transition-transform"
          style={{ backgroundColor: '#31D880' }}
        >
          <Camera className="w-4 h-4 text-[#0B1410]" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handlePhotoSelect}
          className="hidden"
        />
      </div>

      <p className="text-[#0B1410]/40 text-xs mb-10 font-medium uppercase tracking-wider">Toque para alterar</p>

      {/* Name */}
      <div className="w-full max-w-sm mb-10">
        <Input
          type="text"
          placeholder="Seu nome completo"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="h-16 bg-[#0B1410]/5 text-[#0B1410] placeholder-[#0B1410]/30 border-0 rounded-2xl px-6 text-lg focus:ring-1 focus:ring-[#31D880] transition-all"
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={uploading}
        className="w-full max-w-sm h-16 text-[#F7F5EF] text-xl font-bold rounded-2xl border-0 hover:opacity-90 active:scale-[0.98] transition-all font-display shadow-lg shadow-[#0B1410]/10"
        style={{ backgroundColor: '#0B1410' }}
      >
        {uploading ? 'Salvando...' : 'Continuar'}
      </Button>

      <button
        onClick={onNext}
        className="mt-6 text-[#0B1410]/40 text-sm font-medium hover:text-[#0B1410]/60 transition-colors"
      >
        Pular por enquanto
      </button>
    </div>
  );
};
