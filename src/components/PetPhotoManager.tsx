import React, { useState, useRef, useImperativeHandle } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Camera, X, Plus, Trash2, PawPrint } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface PetPhotoManagerProps {
  petId: string;
  photos: string[];
  currentIndex: number;
  onPhotosUpdate: (photos: string[]) => void;
  onIndexChange: (index: number) => void;
  onUploadingChange?: (uploading: boolean) => void;
}

export interface PetPhotoManagerHandle {
  triggerFileInput: () => void;
  deleteCurrentPhoto: () => Promise<void>;
  uploading: boolean;
}

export const PetPhotoManager = React.forwardRef<PetPhotoManagerHandle, PetPhotoManagerProps>(({
  petId,
  photos,
  currentIndex,
  onPhotosUpdate,
  onIndexChange,
  onUploadingChange
}, ref) => {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    triggerFileInput: () => fileInputRef.current?.click(),
    deleteCurrentPhoto: () => handleDeletePhoto(photos[currentIndex], currentIndex),
    uploading
  }));

  const handleAddPhoto = async (file: File) => {
    if (!user) {
      toast.error('Usuário não autenticado');
      return;
    }

    try {
      setUploading(true);
      onUploadingChange?.(true);
      
      if (user) {
        // We'll use a callback pattern or just rely on state if we move state up, 
        // but for now let's just make it work.
      }
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/pets/${petId}/${Date.now()}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('pet-photos')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('pet-photos')
        .getPublicUrl(fileName);

      const updatedPhotos = [...photos, publicUrl];
      onPhotosUpdate(updatedPhotos);
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
      toast.success('Foto adicionada com sucesso!');
    } catch (error: any) {
      console.error('Erro ao fazer upload:', error);
      toast.error(`Erro ao adicionar foto: ${error.message || 'Erro desconhecido'}`);
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  };

  const handleDeletePhoto = async (photoUrl: string, index: number) => {
    if (!user || !photoUrl) return;

    try {
      const urlParts = photoUrl.split('/');
      const fileName = urlParts[urlParts.length - 1];
      const filePath = `${user.id}/pets/${petId}/${fileName}`;

      const { error } = await supabase.storage
        .from('pet-photos')
        .remove([filePath]);

      if (error) throw error;

      const updatedPhotos = photos.filter((_, i) => i !== index);
      onPhotosUpdate(updatedPhotos);
      
      if (currentIndex >= updatedPhotos.length && updatedPhotos.length > 0) {
        onIndexChange(updatedPhotos.length - 1);
      } else if (currentIndex > index) {
        onIndexChange(currentIndex - 1);
      }
      
      toast.success('Foto removida com sucesso!');
    } catch (error: any) {
      console.error('Erro ao deletar foto:', error);
      toast.error(`Erro ao remover foto: ${error.message || 'Erro desconhecido'}`);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Arquivo muito grande. Tamanho máximo: 5MB');
        return;
      }
      
      if (!file.type.startsWith('image/')) {
        toast.error('Por favor, selecione apenas imagens');
        return;
      }
      
      handleAddPhoto(file);
    }
  };

  return (
    <div className="absolute bottom-20 left-0 right-0 px-6 z-20">
      {/* Photo indicators */}
      {photos.length > 1 && (
        <div className="flex justify-center space-x-1.5 mb-2">
          {photos.map((_, index) => (
            <button
              key={index}
              onClick={() => onIndexChange(index)}
              className="h-1 rounded-full transition-all duration-300"
              style={{
                width: index === currentIndex ? 20 : 6,
                background: index === currentIndex ? '#F7F5EF' : 'rgba(247,245,239,0.45)',
              }}
            />
          ))}
        </div>
      )}

      {/* Photo upload disabled per user request */}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
});

PetPhotoManager.displayName = 'PetPhotoManager';

export const PetPhotoManagerActions = ({
  uploading,
  onAddClick,
  onDeleteClick,
  hasPhotos
}: {
  uploading: boolean;
  onAddClick: () => void;
  onDeleteClick: () => void;
  hasPhotos: boolean;
}) => {
  return (
    <div className="flex gap-2">
      {/* Add photo button removed per user request */}
      
      {hasPhotos && (
        <button
          onClick={onDeleteClick}
          aria-label="Excluir foto"
          className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform bg-red-500/20 backdrop-blur-md border border-red-500/10 hover:bg-red-500/30"
        >
          <Trash2 className="w-4 h-4 text-white" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
};
