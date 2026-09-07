import React from 'react';
import { Button } from '@/components/ui/button';

import successBgAsset from "@/assets/success-bg.png.asset.json";

interface SuccessStepProps {
  onNext: () => void;
  petName?: string;
  petPhoto?: string;
  isCompleting?: boolean;
}

export const SuccessStep: React.FC<SuccessStepProps> = ({ onNext, isCompleting }) => {
  return (
    <div className="fixed inset-0 flex flex-col items-center overflow-hidden">
      {/* Background Image */}
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${successBgAsset.url})` }}
      />

      {/* Top Section - Clean Text in white space */}
      <div className="relative z-10 pt-16 px-6 text-center">
        <h1 className="text-[#0B1410] text-3xl font-bold font-display leading-tight opacity-90">
          Aproveite a VaiPet!
        </h1>
        <p className="text-[#0B1410]/60 mt-2 font-medium">
          Tudo pronto para começar.
        </p>
      </div>

      {/* Bottom Section - Clean Button */}
      <div className="mt-auto mb-16 w-full px-8 relative z-10 max-w-sm">
        <Button
          onClick={onNext}
          disabled={isCompleting}
          className="w-full h-16 bg-[#0B1410] text-[#F7F5EF] text-xl font-bold rounded-2xl hover:opacity-95 active:scale-[0.98] transition-all font-display shadow-2xl disabled:opacity-50"
        >
          {isCompleting ? 'Salvando...' : 'Começar agora'}
        </Button>
      </div>
    </div>
  );
};