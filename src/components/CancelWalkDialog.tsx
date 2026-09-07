import React from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';

interface CancelWalkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onGoHome: () => void;
  onSearchAnother: () => void;
}

export const CancelWalkDialog: React.FC<CancelWalkDialogProps> = ({ isOpen, onClose, onGoHome, onSearchAnother }) => {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="mx-4 rounded-[24px] border-border/60">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-center text-foreground text-lg">Cancelar passeio?</AlertDialogTitle>
          <AlertDialogDescription className="text-center text-muted-foreground text-sm">
            Você tem certeza que deseja cancelar este passeio?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:space-x-0">
          <AlertDialogAction onClick={onSearchAnother} className="w-full rounded-xl font-semibold text-white" style={{ background: '#31d880' }}>
            Buscar outro passeador
          </AlertDialogAction>
          <AlertDialogAction onClick={onGoHome} className="w-full rounded-xl font-semibold bg-muted text-foreground hover:bg-muted/80">
            Voltar à tela inicial
          </AlertDialogAction>
          <AlertDialogCancel className="w-full rounded-xl mt-0">
            Continuar com este passeio
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
