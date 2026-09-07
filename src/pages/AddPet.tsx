import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, PawPrint } from 'lucide-react';
import { PetForm } from '@/components/PetForm';
import { useHomeTheme } from '@/hooks/useHomeTheme';

const BRAND = '#31D880';

export const AddPet = () => {
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditing = Boolean(editId);
  const navigate = useNavigate();
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;

  return (
    <div
      className="min-h-screen flex flex-col max-w-md mx-auto"
      style={{
        background: PAPER,
        color: INK,
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      {/* Top bar — editorial */}
      <div className="px-5 pt-6 pb-2 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          aria-label="Voltar"
          className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
          style={{ border: `1px solid ${INK}26`, color: INK }}
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={2.2} />
        </button>
        <span
          className="text-[10px] font-bold uppercase tracking-[0.28em]"
          style={{ opacity: 0.55 }}
        >
          {isEditing ? 'Editar' : 'Novo pet'}
        </span>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: BRAND, color: '#0B1410' }}
        >
          <PawPrint className="w-4 h-4" strokeWidth={2.4} />
        </div>
      </div>

      {/* Editorial headline */}
      <div className="px-5 pt-3 pb-6">
        <h1
          className="font-bold leading-[0.92]"
          style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 'clamp(36px, 11vw, 46px)',
            letterSpacing: '-0.04em',
          }}
        >
          {isEditing ? (
            <>Editar<br />pet</>
          ) : (
            <>Conte sobre<br />seu pet</>
          )}
        </h1>
        <p
          className="mt-3 text-[13px] max-w-[80%]"
          style={{ opacity: 0.6 }}
        >
          {isEditing
            ? 'Atualize as informações do seu companheiro.'
            : 'Conta pra gente sobre seu novo companheiro.'}
        </p>
      </div>

      {/* Form card */}
      <div className="flex-1 px-5 pb-10">
        <div
          className="p-5"
          style={{
            background: PAPER,
            border: `1px solid ${INK}1F`,
            borderRadius: 28,
          }}
        >
          <PetForm editId={editId} isEditing={isEditing} />
        </div>
      </div>
    </div>
  );
};
