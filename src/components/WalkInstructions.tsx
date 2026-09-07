
import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface WalkInstructionsProps {
  onBack: () => void;
  isDarkMode?: boolean;
}

export const WalkInstructions: React.FC<WalkInstructionsProps> = ({ 
  onBack, 
  isDarkMode = false 
}) => {
  return (
    <div className="absolute inset-0 z-30">
      <div className={`w-full h-full ${isDarkMode ? 'bg-[#008F66]' : 'bg-[#31d880]'} p-6`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-8 pt-8">
          <button
            onClick={onBack}
            className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <h1 className="text-2xl font-bold text-white text-center flex-1">
            Renata chegou!
          </h1>
          <div className="w-10 h-10" /> {/* Spacer */}
        </div>

        {/* Content */}
        <div className="text-center mb-8">
          <p className="text-white/90 text-lg mb-8">
            Certifique-se de que;
          </p>

          {/* Instructions */}
          <div className="space-y-6">
            {/* Instruction 1 */}
            <div className="border-2 border-dashed border-white/30 rounded-2xl p-6 text-left">
              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-[#31d880] font-bold text-lg">1</span>
                </div>
                <div>
                  <p className="text-white font-medium text-lg">
                    Seu PET esteja com coleira de passeio.
                  </p>
                </div>
              </div>
            </div>

            {/* Instruction 2 */}
            <div className="border-2 border-dashed border-white/30 rounded-2xl p-6 text-left">
              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-[#31d880] font-bold text-lg">2</span>
                </div>
                <div>
                  <p className="text-white font-medium text-lg">
                    Confirmar o horário de retorno.
                  </p>
                </div>
              </div>
            </div>

            {/* Instruction 3 */}
            <div className="border-2 border-dashed border-white/30 rounded-2xl p-6 text-left">
              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-[#31d880] font-bold text-lg">3</span>
                </div>
                <div>
                  <p className="text-white font-medium text-lg">
                    Confirmar o código do seu aplicativo.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom text */}
        <div className="text-center mt-8">
          <p className="text-white/80 text-sm">
            Sua tela mudará após o Petwalker inserir o código de validação.
          </p>
        </div>
      </div>
    </div>
  );
};
