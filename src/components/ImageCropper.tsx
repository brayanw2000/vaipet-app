import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, RotateCcw, Check } from 'lucide-react';

interface ImageCropperProps {
  imageSrc: string;
  onCrop: (croppedFile: File) => void;
  onCancel: () => void;
}

export const ImageCropper: React.FC<ImageCropperProps> = ({ imageSrc, onCrop, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cropArea, setCropArea] = useState({ x: 0, y: 0, size: 200 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      
      // Calculate initial crop area (centered square)
      const size = Math.min(img.naturalWidth, img.naturalHeight);
      const x = (img.naturalWidth - size) / 2;
      const y = (img.naturalHeight - size) / 2;
      
      setCropArea({ x, y, size });
      setImageLoaded(true);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const scaleX = imageDimensions.width / rect.width;
    const scaleY = imageDimensions.height / rect.height;
    
    const newX = Math.max(0, Math.min((e.clientX - rect.left) * scaleX - cropArea.size / 2, imageDimensions.width - cropArea.size));
    const newY = Math.max(0, Math.min((e.clientY - rect.top) * scaleY - cropArea.size / 2, imageDimensions.height - cropArea.size));
    
    setCropArea(prev => ({ ...prev, x: newX, y: newY }));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleCrop = () => {
    if (!canvasRef.current || !imageRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // Set canvas size to 400x400 for consistent avatar size
      canvas.width = 400;
      canvas.height = 400;

      // Draw the cropped image
      ctx.drawImage(
        img,
        cropArea.x, cropArea.y, cropArea.size, cropArea.size,
        0, 0, 400, 400
      );

      // Convert to blob
      canvas.toBlob((blob) => {
        if (blob) {
          const croppedFile = new File([blob], 'avatar.png', { type: 'image/png' });
          onCrop(croppedFile);
        }
      }, 'image/png', 0.9);
    };
    img.src = imageSrc;
  };

  const resetCrop = () => {
    const size = Math.min(imageDimensions.width, imageDimensions.height);
    const x = (imageDimensions.width - size) / 2;
    const y = (imageDimensions.height - size) / 2;
    setCropArea({ x, y, size });
  };

  if (!imageLoaded) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <div className="text-white">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-md w-full">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold">Ajustar Foto</h3>
          <button onClick={onCancel} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <div className="relative mb-4">
            <img
              ref={imageRef}
              src={imageSrc}
              alt="Crop preview"
              className="w-full h-64 object-contain bg-gray-100 rounded"
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
            
            {/* Crop overlay */}
            <div
              className="absolute border-2 border-white shadow-lg cursor-move"
              style={{
                left: `${(cropArea.x / imageDimensions.width) * 100}%`,
                top: `${(cropArea.y / imageDimensions.height) * 100}%`,
                width: `${(cropArea.size / imageDimensions.width) * 100}%`,
                height: `${(cropArea.size / imageDimensions.height) * 100}%`,
              }}
              onMouseDown={handleMouseDown}
            >
              <div className="absolute inset-0 border border-dashed border-white/50"></div>
            </div>

            {/* Dark overlay for non-crop areas */}
            <div className="absolute inset-0 bg-black/40 pointer-events-none"></div>
            <div 
              className="absolute bg-transparent pointer-events-none"
              style={{
                left: `${(cropArea.x / imageDimensions.width) * 100}%`,
                top: `${(cropArea.y / imageDimensions.height) * 100}%`,
                width: `${(cropArea.size / imageDimensions.width) * 100}%`,
                height: `${(cropArea.size / imageDimensions.height) * 100}%`,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)'
              }}
            ></div>
          </div>

          <p className="text-sm text-gray-600 mb-4 text-center">
            Arraste para posicionar a área de corte
          </p>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={resetCrop}
              className="flex-1"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Resetar
            </Button>
            <Button
              onClick={handleCrop}
              className="flex-1 bg-[#31D880] hover:bg-[#31D880]/90"
            >
              <Check className="w-4 h-4 mr-2" />
              Aplicar
            </Button>
          </div>
        </div>
      </div>

      {/* Hidden canvas for cropping */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};