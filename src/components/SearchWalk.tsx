import React from 'react';
import { MapPin, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const SearchWalk = () => {
  const navigate = useNavigate();

  return (
    <div className="px-5 mb-6">
      <button 
        onClick={() => navigate('/search-walk')}
        className="w-full rounded-2xl py-4 px-6 flex items-center justify-center gap-3 font-bold text-white text-lg transition-all duration-200 hover:brightness-110 active:scale-[0.98] shadow-lg"
        style={{ 
          background: 'linear-gradient(135deg, #31d880, #008F66)',
          boxShadow: '0 8px 24px rgba(49, 216, 128, 0.35)'
        }}
      >
        <MapPin className="w-6 h-6" />
        Buscar passeio
        <ArrowRight className="w-5 h-5 ml-auto" />
      </button>
    </div>
  );
};
