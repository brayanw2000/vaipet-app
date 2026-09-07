import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import splashAsset from '@/assets/animations/splash.gif.asset.json';
import introGifAsset from '@/assets/animations/intro_optimized.gif.asset.json';
import introMusicAsset from '@/assets/audio/intro_music_new.mp3.asset.json';

interface SplashScreenProps {
  onComplete?: () => void;
  variant?: 'logo' | 'animation' | 'video';
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete, variant = 'logo' }) => {
  
  const audioRef = useRef<HTMLAudioElement>(null);
  
  const ANIMATION_GIF = splashAsset.url + "?t=" + Date.now();
  const INTRO_GIF = introGifAsset.url;
  const AUDIO_URL = introMusicAsset.url;
  const LOGO_URL = "/vaipet-logo.svg";

  useEffect(() => {
    console.log(`[SplashScreen] Starting with variant: ${variant}`);
    
    if (variant === 'video') {
      // Try to play audio if it's the intro video (GIF) variant
      if (audioRef.current) {
        audioRef.current.play().catch(error => {
          console.log('[SplashScreen] Audio autoplay failed:', error);
          // If autoplay fails, we just continue without audio
        });
      }

      const timer = setTimeout(() => {
        if (onComplete) onComplete();
      }, 9500);

      return () => clearTimeout(timer);
    }


    const timer = setTimeout(() => {
      console.log(`[SplashScreen] Timer finished for variant: ${variant}`);
      if (onComplete) {
        onComplete();
      }
    }, variant === 'animation' ? 5000 : 2000);

    return () => clearTimeout(timer);
  }, [onComplete, variant]);

  const handleVideoEnd = () => {
    console.log('[SplashScreen] Video ended');
    // Pre-complete callback to notify parent it's almost done
    if (onComplete) {
      onComplete();
    }
  };


  return (
    <motion.div
      data-testid="splash-screen"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.2, ease: "easeInOut" }}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: '#F7F5EF' }}
    >
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="relative w-full h-full flex items-center justify-center overflow-hidden"
      >
        {variant === 'video' ? (
          <div className="w-full h-full flex items-center justify-center bg-white">
            <audio 
              ref={audioRef}
              src={AUDIO_URL} 
              autoPlay 
              playsInline
            />
            <img
              src={INTRO_GIF}
              alt="Intro Animation"
              className="w-full h-full object-cover"
              onLoad={() => {
                console.log('[SplashScreen] Intro GIF loaded');
                // Set a timer to match the GIF duration or roughly 8 seconds as before
                setTimeout(handleVideoEnd, 9500);
              }}
            />
          </div>
        ) : variant === 'animation' ? (
          <div className="w-full h-full flex items-center justify-center bg-white">
            <img
              src={ANIMATION_GIF}
              alt="VaiPet Loading"
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="relative flex h-40 w-40 items-center justify-center">
            {/* Orbital loader arc */}
            <svg
              className="absolute inset-0 h-full w-full animate-splash-spin"
              viewBox="0 0 100 100"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="50"
                cy="50"
                r="46"
                stroke="#31D880"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="60 240"
              />
            </svg>

            {/* Logo with subtle breathing */}
            <img
              src={LOGO_URL}
              alt="VaiPet"
              aria-hidden="true"
              className="relative w-auto h-32 object-contain animate-splash-logo select-none"
              draggable={false}
            />
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

export default SplashScreen;
