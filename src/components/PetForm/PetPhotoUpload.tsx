import React, { useRef } from 'react';
import { ImagePlus, Camera as CameraIcon, Image as ImageIcon } from 'lucide-react';
import { isNative, camera as nativeCamera, haptic } from '@/lib/native';

interface PetPhotoUploadProps {
  photos: File[];
  setPhotos: React.Dispatch<React.SetStateAction<File[]>>;
  currentAvatarUrl?: string;
  isEditing: boolean;
}

export const PetPhotoUpload: React.FC<PetPhotoUploadProps> = ({
  photos,
  setPhotos,
  currentAvatarUrl,
  isEditing
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (photos.length + files.length > 3) {
      return;
    }
    setPhotos(prev => [...prev, ...files].slice(0, 3));
  };

  // Caminho nativo: abre câmera ou galeria do iOS/Android via Capacitor.
  // No browser cai pro <input type="file"> tradicional acima.
  const handleNativePick = async (source: 'camera' | 'library') => {
    if (photos.length >= 3) return;
    haptic.light();
    const picked = await nativeCamera.pick(source);
    if (!picked) return;
    const file = new File([picked.blob], `pet-${Date.now()}.jpg`, { type: picked.mime });
    setPhotos(prev => [...prev, file].slice(0, 3));
    haptic.success();
  };

  return (
    <div className="space-y-4 animate-fade-in" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">
          {isEditing ? 'Alterar foto do pet 📸' : 'Fotos do pet 📸'}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isEditing ? 'Envie uma nova foto (opcional)' : 'Envie até 3 fotos (opcional)'}
        </p>
      </div>
      
      <input
        type="file"
        ref={fileInputRef}
        onChange={handlePhotoSelect}
        accept="image/*"
        multiple
        className="hidden"
      />
      
      {isNative() ? (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleNativePick('camera')}
            className="h-36 border-2 border-dashed border-border/60 rounded-3xl flex flex-col items-center justify-center cursor-pointer bg-card shadow-sm hover:border-accent/40 active:scale-[0.98] transition-all duration-200"
          >
            <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mb-3">
              <CameraIcon className="w-6 h-6 text-accent" />
            </div>
            <span className="text-sm font-medium text-foreground">Câmera</span>
            <span className="text-[11px] text-muted-foreground/60 mt-0.5">Tirar foto agora</span>
          </button>
          <button
            type="button"
            onClick={() => handleNativePick('library')}
            className="h-36 border-2 border-dashed border-border/60 rounded-3xl flex flex-col items-center justify-center cursor-pointer bg-card shadow-sm hover:border-accent/40 active:scale-[0.98] transition-all duration-200"
          >
            <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mb-3">
              <ImageIcon className="w-6 h-6 text-accent" />
            </div>
            <span className="text-sm font-medium text-foreground">Galeria</span>
            <span className="text-[11px] text-muted-foreground/60 mt-0.5">Escolher do rolo</span>
          </button>
        </div>
      ) : (
        <div
          className="h-36 border-2 border-dashed border-border/60 rounded-3xl flex flex-col items-center justify-center cursor-pointer bg-card shadow-sm hover:shadow-md hover:border-accent/40 active:scale-[0.98] transition-all duration-200"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mb-3">
            <ImagePlus className="w-6 h-6 text-accent" />
          </div>
          <span className="text-sm font-medium text-muted-foreground">
            {photos.length > 0 ? `${photos.length} foto(s) selecionada(s)` : 'Toque para adicionar fotos'}
          </span>
          <span className="text-[11px] text-muted-foreground/60 mt-0.5">PNG, JPG até 5MB</span>
        </div>
      )}

      {/* Foto atual (modo edição) */}
      {isEditing && currentAvatarUrl && photos.length === 0 && (
        <div className="flex justify-center animate-scale-in">
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-2">Foto atual:</p>
            <img 
              src={currentAvatarUrl} 
              alt="Foto atual" 
              className="w-20 h-20 object-cover rounded-2xl shadow-md border-2 border-card"
            />
          </div>
        </div>
      )}

      {/* Preview das novas fotos */}
      {photos.length > 0 && (
        <div className="flex gap-3 justify-center">
          {photos.map((photo, index) => (
            <div key={index} className="relative animate-scale-in" style={{ animationDelay: `${index * 80}ms`, animationFillMode: 'both' }}>
              <img
                src={URL.createObjectURL(photo)}
                alt={`Pet ${index + 1}`}
                className="w-20 h-20 object-cover rounded-2xl shadow-md border-2 border-card"
              />
              <button
                type="button"
                onClick={() => setPhotos(prev => prev.filter((_, i) => i !== index))}
                className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-sm hover:scale-110 active:scale-95 transition-transform"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
