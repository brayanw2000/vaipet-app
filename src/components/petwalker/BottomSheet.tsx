import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface BottomSheetProps {
  isOpen: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
  isHighPriority?: boolean;
  dismissible?: boolean;
  navigationOffset?: boolean;
}

export const BottomSheet = ({ 
  isOpen, 
  onClose, 
  children, 
  title, 
  className,
  isHighPriority = false,
  dismissible = true,
  navigationOffset = true
}: BottomSheetProps) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop for high priority only */}
          {isHighPriority && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={dismissible ? onClose : undefined}
              className={cn(
                "fixed inset-0 bg-black/40 z-[60] backdrop-blur-[2px]",
                !dismissible && "cursor-default"
              )}
            />
          )}
          
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            drag={dismissible ? "y" : false}
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (dismissible && onClose && info.offset.y > 100) {
                onClose();
              }
            }}
            className={cn(
              "fixed bottom-0 left-0 right-0 bg-surface rounded-t-[16px] shadow-[0_-8px_30px_rgba(0,0,0,0.08)] z-[70] px-6 pb-8 pt-2 max-w-lg mx-auto border-t border-separator",
              isHighPriority && "z-[80]",
              className
            )}
            style={{ 
              paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 24px)`,
              marginBottom: navigationOffset ? 'calc(64px + env(safe-area-inset-bottom, 0px))' : 0
            }}
          >
            <div className="w-10 h-1.5 bg-separator rounded-full mx-auto mb-6" />
            
            {title && (
              <h3 className="text-ios-title-3 font-bold mb-4">{title}</h3>
            )}
            
            <div className="space-y-4">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
