import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { X, ArrowRight, MousePointer2 } from 'lucide-react';

interface Step {
  targetId: string;
  title: string;
  description: string;
}

const steps: Step[] = [
  {
    targetId: 'tour-pet-chips',
    title: 'Seus Pets',
    description: 'Aqui você vê seus pets e adiciona novos.',
  },
  {
    targetId: 'tour-nav-walk',
    title: 'Pedir Passeio',
    description: 'Encontre um passeador agora mesmo.',
  },
  {
    targetId: 'tour-history',
    title: 'Histórico',
    description: 'Veja os detalhes de passeios passados.',
  },
  {
    targetId: 'tour-nav-shop',
    title: 'Pet Shop',
    description: 'Produtos e serviços para o seu pet.',
  }
];

export const GuidedTour: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const { palette } = useHomeTheme();

  useEffect(() => {
    const hasSeenTour = localStorage.getItem('vaipet_tour_seen');
    const onboardingJustFinished = sessionStorage.getItem('vaipet_onboarding_just_finished');
    
    if (!hasSeenTour && onboardingJustFinished) {
      const timer = setTimeout(() => setIsVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (isVisible) {
      const updateCoords = () => {
        const step = steps[currentStep];
        const el = document.getElementById(step.targetId);
        if (el) {
          const rect = el.getBoundingClientRect();
          setCoords({
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
          });
        }
      };

      updateCoords();
      window.addEventListener('scroll', updateCoords);
      window.addEventListener('resize', updateCoords);
      return () => {
        window.removeEventListener('scroll', updateCoords);
        window.removeEventListener('resize', updateCoords);
      };
    }
  }, [isVisible, currentStep]);

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleClose();
    }
  };

  const handleClose = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsVisible(false);
    localStorage.setItem('vaipet_tour_seen', 'true');
    sessionStorage.removeItem('vaipet_onboarding_just_finished');
  };

  if (!isVisible) return null;

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;

  // Determine if pop-up should be above or below based on vertical space
  const showBelow = coords.top < 300;

  return (
    <div 
      className="fixed inset-0 z-[200] overflow-hidden pointer-events-auto"
      onClick={handleClose}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[#0B1410]/60 backdrop-blur-[2px]"
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, scale: 0.9, y: showBelow ? 10 : -10 }}
          animate={{ 
            opacity: 1, 
            scale: 1, 
            y: 0,
            top: showBelow ? coords.top + coords.height + 16 : coords.top - 16,
            left: Math.max(16, Math.min(window.innerWidth - 300, coords.left + coords.width / 2 - 140))
          }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="absolute z-[210] w-[calc(100vw-32px)] max-w-[280px] rounded-[32px] p-6 shadow-2xl pointer-events-auto"
          style={{ 
            background: palette.paper, 
            color: palette.ink,
            transform: showBelow ? 'none' : 'translateY(-100%)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Arrow */}
          <div 
            className="absolute left-1/2 -translate-x-1/2 w-4 h-4 rotate-45"
            style={{ 
              background: palette.paper,
              top: showBelow ? -8 : 'auto',
              bottom: showBelow ? 'auto' : -8
            }}
          />

          <h3 className="text-lg font-bold mb-1.5" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            {step.title}
          </h3>
          <p className="text-[15px] opacity-80 leading-relaxed mb-6">
            {step.description}
          </p>

          <div className="flex items-center justify-between">
            <button
              onClick={handleClose}
              className="text-xs font-medium opacity-50 hover:opacity-100 transition-opacity"
            >
              Pular
            </button>
            <button
              onClick={handleNext}
              className="flex items-center gap-2 py-2 px-4 rounded-full text-xs font-bold active:scale-95 transition-all shadow-md shadow-[#31D880]/20"
              style={{ background: '#31D880', color: '#0B1410' }}
            >
              {isLast ? 'Entendi' : 'Próximo'}
              {!isLast && <ArrowRight size={14} />}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Spotlight highlight */}
      <motion.div 
        animate={{ 
          top: coords.top - 6, 
          left: coords.left - 6, 
          width: coords.width + 12, 
          height: coords.height + 12,
          boxShadow: [
            '0 0 0 0px rgba(49,216,128,0)',
            '0 0 0 10px rgba(49,216,128,0.2)',
            '0 0 0 0px rgba(49,216,128,0)'
          ]
        }}
        transition={{ 
          boxShadow: { repeat: Infinity, duration: 2 },
          duration: 0.3
        }}
        className="absolute z-[205] rounded-2xl ring-[2000px] ring-[#0B1410]/80 pointer-events-none transition-all"
      />
    </div>
  );
};
