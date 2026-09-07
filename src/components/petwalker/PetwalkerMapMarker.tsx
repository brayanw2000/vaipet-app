import React from 'react';
import { cn } from '@/lib/utils';

interface PetwalkerMapMarkerProps {
  type: 'walker' | 'pet' | 'meeting';
  className?: string;
}

export const PetwalkerMapMarker = ({ type, className }: PetwalkerMapMarkerProps) => {
  return (
    <div className={cn("relative flex items-center justify-center w-10 h-10", className)}>
      <div className={cn(
        "absolute w-full h-full rounded-full opacity-20 animate-ping",
        type === 'walker' ? "bg-primary" : type === 'pet' ? "bg-app-orange" : "bg-blue-500"
      )} />
      <div className={cn(
        "relative w-6 h-6 rounded-full border-2 border-white shadow-md flex items-center justify-center",
        type === 'walker' ? "bg-primary" : type === 'pet' ? "bg-app-orange" : "bg-blue-500"
      )}>
        {type === 'walker' && <div className="w-2 h-2 bg-white rounded-full" />}
        {type === 'pet' && <span className="text-[10px]">🐾</span>}
      </div>
    </div>
  );
};
