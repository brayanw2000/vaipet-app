import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Camera, ArrowLeft, User, Mail, Phone, Save, UserCircle2 } from 'lucide-react';
import { BottomNavigation } from '@/components/BottomNavigation';
import { ImageCropper } from '@/components/ImageCropper';
import { useHomeTheme } from '@/hooks/useHomeTheme';

const BRAND = '#31D880';

export const Profile = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;
  
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    bio: ''
  });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>('');
  const [showCropper, setShowCropper] = useState(false);
  const [originalImage, setOriginalImage] = useState<string>('');

  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        bio: profile.bio || ''
      });
      setAvatarPreview(profile.avatar_url || '');
    }
  }, [profile]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAvatarSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast.error('A imagem deve ter no máximo 5MB');
        return;
      }

      // Create preview and show cropper
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageUrl = e.target?.result as string;
        setOriginalImage(imageUrl);
        setShowCropper(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCropComplete = (croppedFile: File) => {
    setAvatarFile(croppedFile);
    
    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setAvatarPreview(e.target?.result as string);
    };
    reader.readAsDataURL(croppedFile);
    
    setShowCropper(false);
  };

  const handleCropCancel = () => {
    setShowCropper(false);
    setOriginalImage('');
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadAvatar = async (file: File): Promise<string | null> => {
    try {
      if (!user?.id) return null;
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      console.log('Tentando upload para:', filePath);

      const { data, error } = await supabase.storage
        .from('pet-photos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (error) {
        console.error('Erro detalhado do Storage:', error);
        return null;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('pet-photos')
        .getPublicUrl(data.path);

      return publicUrl;
    } catch (error) {
      console.error('Exceção no uploadAvatar:', error);
      return null;
    }
  };


  const handleSave = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      let avatarUrl = profile?.avatar_url;

      // Upload new avatar if selected
      if (avatarFile) {
        console.log('Iniciando upload do avatar:', avatarFile.name);
        const uploadedUrl = await uploadAvatar(avatarFile);
        if (uploadedUrl) {
          avatarUrl = uploadedUrl;
          console.log('Upload concluído com sucesso:', avatarUrl);
        } else {
          console.error('Falha no upload do avatar');
          toast.error('Erro ao fazer upload da foto. Verifique sua conexão.');
          setIsLoading(false);
          return;
        }
      }

      // Update profile
      console.log('Atualizando perfil na tabela profiles...', { id: user.id, avatarUrl });
      const { data, error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          full_name: formData.full_name,
          phone: formData.phone,
          bio: formData.bio,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString()
        })
        .select();

      if (error) {
        console.error('Erro na query de atualização:', error);
        toast.error(`Erro ao atualizar perfil: ${error.message}`);
        return;
      }

      console.log('Perfil atualizado com sucesso no banco:', data);

      // Update auth metadata if name changed
      if (formData.full_name !== user.user_metadata?.full_name) {
        await supabase.auth.updateUser({
          data: { full_name: formData.full_name }
        });
      }

      toast.success('Perfil atualizado com sucesso!');
      
      // Delay reload to let user see success message
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      
    } catch (error: any) {
      console.error('Exceção capturada ao salvar perfil:', error);
      toast.error('Ocorreu um erro inesperado ao salvar.');
    } finally {
      setIsLoading(false);
    }
  };

  const getUserInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div
      className="min-h-screen flex flex-col max-w-md mx-auto relative"
      style={{ background: PAPER, color: INK, fontFamily: 'DM Sans, sans-serif' }}
    >
      <div className="flex-1 pb-28">
        {/* Top bar */}
        <div className="px-5 pt-6 pb-2 flex items-center justify-between">
          <button
            onClick={() => navigate('/configuracoes')}
            aria-label="Voltar"
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{ border: `1px solid ${INK}26`, color: INK }}
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2.2} />
          </button>
          <span
            className="text-[10px] font-bold uppercase tracking-[0.28em]"
            style={{ opacity: 0.55 }}
          >
            Perfil
          </span>
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: BRAND, color: '#0B1410' }}
          >
            <UserCircle2 className="w-4 h-4" strokeWidth={2.4} />
          </div>
        </div>

        {/* Headline */}
        <div className="px-5 pt-3 pb-6">
          <h1
            className="font-bold leading-[0.92]"
            style={{
              fontFamily: 'Space Grotesk, sans-serif',
              fontSize: 'clamp(36px, 11vw, 46px)',
              letterSpacing: '-0.04em',
            }}
          >
            Editar<br />perfil
          </h1>
          <p className="mt-3 text-[13px] max-w-[80%]" style={{ opacity: 0.6 }}>
            Mantenha suas informações sempre atualizadas.
          </p>
        </div>

        {/* Avatar */}
        <div className="flex flex-col items-center mb-6 px-6">
          <div className="relative">
            <div
              className="w-28 h-28 rounded-full overflow-hidden flex items-center justify-center"
              style={{ background: `${BRAND}26`, border: `2px solid ${INK}1F` }}
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span
                  className="text-3xl font-bold"
                  style={{ fontFamily: 'Space Grotesk, sans-serif', color: '#0B1410' }}
                >
                  {formData.full_name ? getUserInitials(formData.full_name) : 'U'}
                </span>
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              aria-label="Trocar foto"
              className="absolute -bottom-1 -right-1 w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{ background: BRAND, color: '#0B1410', border: `2px solid ${PAPER}` }}
            >
              <Camera className="w-4 h-4" strokeWidth={2.4} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarSelect}
              className="hidden"
            />
          </div>
          <p className="text-[11px] mt-3" style={{ opacity: 0.6 }}>
            Toque na câmera para alterar a foto
          </p>
        </div>

        {/* Form card */}
        <div className="px-5 mb-6">
          <div
            className="p-5 space-y-4"
            style={{ background: PAPER, border: `1px solid ${INK}1F`, borderRadius: 28 }}
          >
            {[
              { icon: User, label: 'Nome completo', field: 'full_name', placeholder: 'Digite seu nome', disabled: false },
              { icon: Mail, label: 'Email', field: 'email', placeholder: '', disabled: true },
              { icon: Phone, label: 'Telefone', field: 'phone', placeholder: '(11) 99999-9999', disabled: false },
            ].map(({ icon: Icon, label, field, placeholder, disabled }) => (
              <div key={field}>
                <label className="flex items-center gap-2 mb-2">
                  <Icon className="w-3.5 h-3.5" style={{ color: BRAND }} strokeWidth={2.4} />
                  <span
                    className="text-[10px] font-bold uppercase tracking-[0.22em]"
                    style={{ opacity: 0.6 }}
                  >
                    {label}
                  </span>
                </label>
                <Input
                  value={(formData as any)[field]}
                  onChange={(e) => handleInputChange(field, e.target.value)}
                  placeholder={placeholder}
                  disabled={disabled}
                  className="h-12 rounded-2xl bg-transparent px-4"
                  style={{ border: `1px solid ${INK}26`, opacity: disabled ? 0.5 : 1 }}
                />
                {disabled && (
                  <p className="text-[10px] mt-1.5" style={{ opacity: 0.5 }}>
                    O email não pode ser alterado.
                  </p>
                )}
              </div>
            ))}

            <div>
              <label className="flex items-center gap-2 mb-2">
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.22em]"
                  style={{ opacity: 0.6 }}
                >
                  Sobre você
                </span>
              </label>
              <textarea
                value={formData.bio}
                onChange={(e) => handleInputChange('bio', e.target.value)}
                placeholder="Conte um pouco sobre você…"
                className="w-full h-28 px-4 py-3 resize-none bg-transparent outline-none text-sm"
                style={{
                  border: `1px solid ${INK}26`,
                  borderRadius: 20,
                  fontFamily: 'DM Sans, sans-serif',
                }}
              />
            </div>
          </div>
        </div>

        {/* Save */}
        <div className="px-5">
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="w-full h-14 rounded-full flex items-center justify-center gap-2 font-bold active:scale-[0.98] transition-transform disabled:opacity-50"
            style={{
              background: BRAND,
              color: '#0B1410',
              fontFamily: 'Space Grotesk, sans-serif',
              letterSpacing: '-0.01em',
              fontSize: 14,
            }}
          >
            {isLoading ? (
              <>
                <div
                  className="w-4 h-4 border-2 rounded-full animate-spin"
                  style={{ borderColor: 'rgba(11,20,16,0.3)', borderTopColor: '#0B1410' }}
                />
                Salvando…
              </>
            ) : (
              <>
                <Save className="w-4 h-4" strokeWidth={2.4} />
                Salvar alterações
              </>
            )}
          </button>
        </div>
      </div>

      <BottomNavigation />

      {/* Image Cropper Modal */}
      {showCropper && (
        <ImageCropper
          imageSrc={originalImage}
          onCrop={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  );
};