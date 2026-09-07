import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Camera, ChevronLeft } from 'lucide-react';
import logoAsset from "@/assets/vaipet-logo-new.png.asset.json";

const VaiPetLogo = () => (
  <img 
    src="/vaipet-logo.svg" 
    alt="VaiPet" 
    className="w-48 h-auto"
  />
);

interface PetRegistrationStepProps {
  onNext: (data?: {name: string, photo?: string}) => void;
  onBack?: () => void;
}

export const PetRegistrationStep: React.FC<PetRegistrationStepProps> = ({ onNext, onBack }) => {
  const [petName, setPetName] = useState('');
  const [breed, setBreed] = useState('');
  const [age, setAge] = useState('');
  const [ageUnit, setAgeUnit] = useState('anos');
  const [temperament, setTemperament] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (photos.length + files.length > 3) {
      toast.error('Máximo de 3 fotos permitidas');
      return;
    }
    setPhotos(prev => [...prev, ...files].slice(0, 3));
  };

  const uploadPhotos = async (petId: string) => {
    if (photos.length === 0) return [];

    setUploading(true);
    const uploadedUrls: string[] = [];

    try {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const fileExt = photo.name.split('.').pop();
        const fileName = `${user?.id}/pets/${petId}/${Date.now()}-${i}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('pet-photos')
          .upload(fileName, photo);

        if (uploadError) {
          console.error('Erro no upload:', uploadError);
          throw uploadError;
        }

        const { data } = supabase.storage
          .from('pet-photos')
          .getPublicUrl(fileName);

        uploadedUrls.push(data.publicUrl);
      }
    } catch (error) {
      console.error('Erro ao fazer upload das fotos:', error);
      toast.error('Erro ao fazer upload das fotos');
    } finally {
      setUploading(false);
    }

    return uploadedUrls;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!petName || !breed || !age || !temperament) {
      toast.error('Por favor, preencha todos os campos');
      return;
    }

    setLoading(true);

    try {
      // Primeiro inserir o pet
      const { data: petData, error: petError } = await supabase
        .from('pets')
        .insert({
          owner_id: user?.id,
          name: petName,
          breed: breed,
          age: ageUnit === 'meses' ? Math.round(parseInt(age) / 12 * 10) / 10 : parseInt(age),
          behavioral_notes: temperament,
          is_active: true
        })
        .select()
        .single();

      if (petError) {
        console.error('Erro ao cadastrar pet:', petError);
        toast.error('Erro ao cadastrar pet');
        return;
      }

      // Depois fazer upload das fotos se houver
      let photoUrls: string[] = [];
      if (photos.length > 0) {
        photoUrls = await uploadPhotos(petData.id);
        
        // Salvar a primeira foto como avatar_url
        if (photoUrls.length > 0) {
          const { error: updateError } = await supabase
            .from('pets')
            .update({ avatar_url: photoUrls[0] })
            .eq('id', petData.id);

          if (updateError) {
            console.error('Erro ao atualizar avatar do pet:', updateError);
          }
        }
      }

      const petDataToPass = {
        name: petName,
        photo: photoUrls.length > 0 ? photoUrls[0] : undefined
      };

      toast.success('Pet cadastrado com sucesso!');
      onNext(petDataToPass);
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao cadastrar pet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-20 p-6 bg-[#F7F5EF] relative">
      {onBack && (
        <button 
          onClick={onBack}
          className="absolute top-12 left-6 p-2 text-[#0B1410] hover:bg-[#0B1410]/5 rounded-full transition-colors"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}
      <div className="w-full max-w-sm">
        <h1 className="text-[#0B1410] text-3xl font-bold text-center mb-10 tracking-tight font-display leading-[1.1]">
          Conte sobre<br />
          seu pet
        </h1>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="text"
            placeholder="Nome do pet"
            value={petName}
            onChange={(e) => setPetName(e.target.value)}
            className="h-16 bg-[#0B1410]/5 text-[#0B1410] placeholder-[#0B1410]/30 border-0 rounded-2xl px-6 text-lg focus:ring-1 focus:ring-[#31D880] transition-all"
            required
          />
          
          <Input
            type="text"
            placeholder="Raça"
            value={breed}
            onChange={(e) => setBreed(e.target.value)}
            className="h-16 bg-[#0B1410]/5 text-[#0B1410] placeholder-[#0B1410]/30 border-0 rounded-2xl px-6 text-lg focus:ring-1 focus:ring-[#31D880] transition-all"
            required
          />
          
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Idade"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="h-16 bg-[#0B1410]/5 text-[#0B1410] placeholder-[#0B1410]/30 border-0 rounded-2xl px-6 text-lg flex-1 focus:ring-1 focus:ring-[#31D880] transition-all"
              required
              min="1"
              max={ageUnit === 'anos' ? '30' : '360'}
            />
            <Select value={ageUnit} onValueChange={setAgeUnit}>
              <SelectTrigger className="h-16 bg-[#0B1410]/5 text-[#0B1410] border-0 rounded-2xl px-4 text-lg w-32 focus:ring-1 focus:ring-[#31D880]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anos">Anos</SelectItem>
                <SelectItem value="meses">Meses</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <Select value={temperament} onValueChange={setTemperament}>
            <SelectTrigger className="h-16 bg-[#0B1410]/5 text-[#0B1410] border-0 rounded-2xl px-6 text-lg focus:ring-1 focus:ring-[#31D880]">
              <SelectValue placeholder="Qual humor do pet?" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="docil">Dócil</SelectItem>
              <SelectItem value="moderavel">Moderável</SelectItem>
              <SelectItem value="agressivo">Agressivo</SelectItem>
            </SelectContent>
          </Select>
          
          <div className="mt-8">
            <p className="text-[#0B1410]/60 text-sm text-center mb-4 font-medium uppercase tracking-wider">
              Fotos (até 3)
            </p>
            
            <input
              type="file"
              ref={fileInputRef}
              onChange={handlePhotoSelect}
              accept="image/*"
              multiple
              className="hidden"
            />
            
            <div 
              className="h-32 bg-[#0B1410]/5 rounded-3xl border-2 border-dashed border-[#0B1410]/10 flex items-center justify-center mb-6 cursor-pointer hover:border-[#31D880] transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="flex flex-col items-center">
                <Camera className="w-8 h-8 text-[#0B1410]/20 mb-2" />
                <span className="text-[#0B1410]/40 text-sm">
                  {photos.length > 0 ? `${photos.length} foto(s) selecionada(s)` : 'Adicionar fotos'}
                </span>
              </div>
            </div>

            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                {photos.map((photo, index) => (
                  <div key={index} className="relative aspect-square">
                    <img
                      src={URL.createObjectURL(photo)}
                      alt={`Pet ${index + 1}`}
                      className="w-full h-full object-cover rounded-xl"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotos(prev => prev.filter((_, i) => i !== index))}
                      className="absolute -top-2 -right-2 bg-[#F14A00] text-white rounded-full w-6 h-6 flex items-center justify-center text-sm shadow-sm"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <Button
            type="submit"
            disabled={loading || uploading}
            className="w-full h-16 text-[#F7F5EF] text-xl font-bold rounded-2xl border-0 mt-4 hover:opacity-90 active:scale-[0.98] transition-all font-display shadow-lg shadow-[#0B1410]/10"
            style={{ backgroundColor: '#0B1410' }}
          >
            {loading ? 'Cadastrando...' : uploading ? 'Enviando fotos...' : 'Finalizar cadastro'}
          </Button>

          <button
            type="button"
            onClick={() => onNext()}
            className="w-full py-4 text-[#0B1410]/60 text-lg font-medium hover:text-[#0B1410] transition-colors"
          >
            Pular e adicionar depois
          </button>
        </form>
      </div>
    </div>
  );
};