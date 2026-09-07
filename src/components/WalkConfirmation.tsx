
import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface WalkConfirmationProps {
  onBack: () => void;
  isDarkMode?: boolean;
}

export const WalkConfirmation: React.FC<WalkConfirmationProps> = ({ 
  onBack, 
  isDarkMode = false 
}) => {
  return (
    <div className="absolute inset-0 z-30">
      <div className="w-full h-full bg-white p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 pt-8">
          <button
            onClick={onBack}
            className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1" />
        </div>

        {/* Content */}
        <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
          {/* Profile image */}
          <div className="w-20 h-20 rounded-full overflow-hidden mb-8">
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/b/bf/Foto_Perfil_.jpg" 
              alt="Petwalker Profile" 
              className="w-full h-full object-cover"
            />
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Seu Petwalker
          </h1>
          <h2 className="text-2xl font-bold text-[#31d880] mb-6">
            está a caminho!
          </h2>
          
          <p className="text-gray-600 text-lg mb-12">
            <span className="font-semibold">5 minutos</span> até a chegada
          </p>

          {/* Dog animation - Much larger */}
          <div className="w-80 h-48 mb-12 flex items-center justify-center">
            <img 
              src="https://cdn.dribbble.com/userupload/42433279/file/original-b6345c31b2555ff74671411dfe0d0611.gif" 
              alt="Dog walking animation" 
              className="w-full h-full object-contain"
            />
          </div>

          {/* Confirmation code */}
          <div className="text-center mb-12">
            <p className="text-gray-600 text-lg mb-4">
              Código de confirmação:
            </p>
            <div className="text-4xl font-bold text-gray-900 mb-8">
              0504
            </div>
          </div>

          {/* Chat button */}
          <button className="border-2 border-dashed border-[#31d880] text-[#31d880] font-medium py-3 px-8 rounded-full">
            Bate-papo
          </button>
        </div>
      </div>
    </div>
  );
};
