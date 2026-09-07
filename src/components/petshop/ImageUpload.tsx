import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { X, Plus, Upload } from 'lucide-react';

interface ImageUploadProps {
  images: File[];
  onChange: (images: File[]) => void;
  maxImages?: number;
  existingImages?: string[]; // URLs das imagens existentes
  onRemoveExisting?: (url: string) => void;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  images,
  onChange,
  maxImages = 10,
  existingImages = [],
  onRemoveExisting,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const validFiles = files.filter(file => file.type.startsWith('image/'));
    
    const totalImages = existingImages.length + images.length;
    if (totalImages + validFiles.length > maxImages) {
      const remainingSlots = maxImages - totalImages;
      onChange([...images, ...validFiles.slice(0, remainingSlots)]);
    } else {
      onChange([...images, ...validFiles]);
    }
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    onChange(newImages);
  };

  const getImageUrl = (file: File) => {
    return URL.createObjectURL(file);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Imagens do Produto</h3>
        <span className="text-sm text-muted-foreground">
          {existingImages.length + images.length}/{maxImages}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* Existing images */}
        {existingImages.map((imageUrl, index) => (
          <Card key={`existing-${index}`} className="relative overflow-hidden">
            <CardContent className="p-0">
              <div className="aspect-square relative">
                <img
                  src={imageUrl}
                  alt={`Imagem existente ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                {onRemoveExisting && (
                  <button
                    type="button"
                    onClick={() => onRemoveExisting(imageUrl)}
                    className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/90"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                {index === 0 && existingImages.length > 0 && (
                  <div className="absolute bottom-1 left-1 bg-primary text-primary-foreground text-xs px-2 py-1 rounded">
                    Principal
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {/* New images */}
        {images.map((image, index) => (
          <Card key={`new-${index}`} className="relative overflow-hidden">
            <CardContent className="p-0">
              <div className="aspect-square relative">
                <img
                  src={getImageUrl(image)}
                  alt={`Upload ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/90"
                >
                  <X className="h-3 w-3" />
                </button>
                {index === 0 && existingImages.length === 0 && (
                  <div className="absolute bottom-1 left-1 bg-primary text-primary-foreground text-xs px-2 py-1 rounded">
                    Principal
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {(existingImages.length + images.length) < maxImages && (
          <Card className="border-dashed">
            <CardContent className="p-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-square flex flex-col items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
              >
                <Plus className="h-6 w-6 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Adicionar</span>
              </button>
            </CardContent>
          </Card>
        )}
      </div>

      {(existingImages.length + images.length) === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-6">
            <div className="text-center">
              <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-4">
                Adicione até {maxImages} imagens do produto
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                Escolher Imagens
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
};