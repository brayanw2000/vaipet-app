import React, { useState, useRef } from 'react';
import { BottomNavigation } from '@/components/BottomNavigation';
import {
  Search,
  Stethoscope,
  Syringe,
  FlaskConical,
  HeartPulse,
  Scissors,
  Bug,
  Smile,
  Brain,
  Bone,
  Eye,
  Sparkles,
  ArrowLeft,
  ArrowUpRight,
  Star,
  MapPin,
  Clock,
  Phone,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHomeTheme } from '@/hooks/useHomeTheme';

const BRAND = '#31D880';

const specialties: { name: string; short: string; icon: React.ElementType; tint: string }[] = [
  { name: 'Todos', short: 'Todos', icon: Stethoscope, tint: '#E8F8EE' },
  { name: 'Emergência', short: 'Emerg.', icon: HeartPulse, tint: '#FFD9D9' },
  { name: 'Consulta', short: 'Consulta', icon: Stethoscope, tint: '#E6EEFF' },
  { name: 'Vacinação', short: 'Vacinas', icon: Syringe, tint: '#FFF6CC' },
  { name: 'Cirurgia', short: 'Cirurgia', icon: Scissors, tint: '#FFE3EC' },
  { name: 'Exames', short: 'Exames', icon: FlaskConical, tint: '#F0E4FF' },
  { name: 'Dermatologia', short: 'Derma', icon: Bug, tint: '#DFF4FF' },
  { name: 'Odontologia', short: 'Odonto', icon: Smile, tint: '#E0F0E8' },
  { name: 'Neurologia', short: 'Neuro', icon: Brain, tint: '#E4E4F8' },
  { name: 'Ortopedia', short: 'Ortop.', icon: Bone, tint: '#FFEAB8' },
  { name: 'Oftalmologia', short: 'Oftalmo', icon: Eye, tint: '#FFE9D6' },
];

// Placeholder vet clinics — replace later with real data from backend
const vetPlaceholders: {
  id: string;
  name: string;
  specialty: string;
  rating: number;
  reviews: number;
  distance: string;
  open: boolean;
  tint: string;
}[] = [
  { id: 'v1', name: 'Clínica VetVida', specialty: 'Consulta · Vacinas', rating: 4.9, reviews: 312, distance: '1.2 km', open: true, tint: '#E8F8EE' },
  { id: 'v2', name: 'Pet Care 24h', specialty: 'Emergência 24h', rating: 4.8, reviews: 187, distance: '2.4 km', open: true, tint: '#FFD9D9' },
  { id: 'v3', name: 'AnimalLab', specialty: 'Exames · Imagem', rating: 4.7, reviews: 98, distance: '3.1 km', open: false, tint: '#E6EEFF' },
  { id: 'v4', name: 'Sorriso Animal', specialty: 'Odontologia', rating: 4.9, reviews: 64, distance: '4.0 km', open: true, tint: '#E0F0E8' },
];

const promoSlides: { id: string; eyebrow: string; title: string; subtitle: string; cta: string; bg: string; fg: string }[] = [
  { id: 'p1', eyebrow: 'Plano Saúde Pet', title: '1ª consulta grátis para novos tutores', subtitle: 'Veterinários parceiros verificados.', cta: 'Ativar agora', bg: '#0B1410', fg: '#F7F5EF' },
  { id: 'p2', eyebrow: 'Vacinação', title: 'Campanha V10 com 30% off', subtitle: 'Durante todo o mês na rede credenciada.', cta: 'Quero garantir', bg: BRAND, fg: '#0B1410' },
  { id: 'p3', eyebrow: 'Emergência 24h', title: 'Atendimento de urgência sempre perto', subtitle: 'Encontre clínicas abertas agora.', cta: 'Ver abertas', bg: '#E4FF7A', fg: '#0B1410' },
];

const Veterinario = () => {
  const navigate = useNavigate();
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSpec, setSelectedSpec] = useState('Todos');
  const [promoIndex, setPromoIndex] = useState(0);
  const promoRef = useRef<HTMLDivElement>(null);

  const onPromoScroll = () => {
    const el = promoRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== promoIndex) setPromoIndex(idx);
  };

  const term = searchTerm.trim().toLowerCase();
  const filteredVets = vetPlaceholders.filter((v) => {
    const matchTerm =
      !term ||
      v.name.toLowerCase().includes(term) ||
      v.specialty.toLowerCase().includes(term);
    const matchSpec =
      selectedSpec === 'Todos' ||
      v.specialty.toLowerCase().includes(selectedSpec.toLowerCase().slice(0, 5));
    return matchTerm && matchSpec;
  });

  return (
    <div
      className="min-h-screen flex flex-col max-w-md mx-auto relative"
      style={{ background: PAPER, color: INK, fontFamily: 'DM Sans, sans-serif' }}
    >
      <div className="flex-1 pb-28">
        {/* Top bar */}
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
            Saúde Pet
          </span>
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: BRAND, color: '#0B1410' }}
          >
            <Stethoscope className="w-4 h-4" strokeWidth={2.4} />
          </div>
        </div>

        {/* Headline */}
        <div className="px-5 pt-3 pb-5">
          <h1
            className="font-bold leading-[0.92]"
            style={{
              fontFamily: 'Space Grotesk, sans-serif',
              fontSize: 'clamp(36px, 11vw, 46px)',
              letterSpacing: '-0.04em',
            }}
          >
            Veterinário
          </h1>
          <p className="mt-3 text-[13px] max-w-[82%]" style={{ opacity: 0.6 }}>
            Cuidado especializado para o seu pet, perto de você.
          </p>
        </div>

        {/* Search */}
        <div className="px-5">
          <label
            className="flex items-center gap-2.5 px-4"
            style={{
              background: PAPER,
              border: `1px solid ${INK}1F`,
              borderRadius: 999,
              height: 48,
            }}
          >
            <Search className="w-4 h-4 flex-shrink-0" style={{ opacity: 0.55 }} />
            <input
              type="text"
              placeholder="Buscar clínica ou especialidade…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 min-w-0 bg-transparent outline-none text-[14px]"
              style={{ color: INK, fontFamily: 'DM Sans, sans-serif' }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label="Limpar busca"
                className="flex-shrink-0 active:scale-90 transition-transform"
                style={{ color: INK, opacity: 0.5 }}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </label>
        </div>

        {/* Specialties — bubbles, horizontal scroll */}
        <div
          className="mt-5 flex gap-3.5 overflow-x-auto overflow-y-hidden pb-5 pt-1 px-5 scrollbar-hide"
          style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
        >
          {specialties.map((spec) => {
            const Icon = spec.icon;
            const isActive = selectedSpec === spec.name;
            return (
              <button
                key={spec.name}
                onClick={() => setSelectedSpec(spec.name)}
                className="flex-shrink-0 flex flex-col items-center gap-1.5 active:scale-95 transition-transform"
                style={{ width: 62, scrollSnapAlign: 'start' }}
              >
                <div
                  className="relative w-[62px] h-[62px] rounded-full flex items-center justify-center overflow-hidden"
                  style={{
                    background: spec.tint,
                    border: isActive ? `2.5px solid ${BRAND}` : `2.5px solid transparent`,
                    boxShadow: isActive
                      ? '0 8px 18px -10px rgba(49,216,128,0.6)'
                      : 'none',
                    transition: 'all .2s ease',
                  }}
                >
                  <Icon
                    className="w-7 h-7"
                    strokeWidth={2}
                    style={{ color: '#0B1410', opacity: 0.78 }}
                  />
                  {isActive && (
                    <span className="absolute inset-0" style={{ background: `${BRAND}1F` }} />
                  )}
                </div>
                <span
                  className="text-[11px] font-semibold text-center leading-tight"
                  style={{
                    color: INK,
                    opacity: isActive ? 1 : 0.7,
                    fontFamily: 'Space Grotesk, sans-serif',
                  }}
                >
                  {spec.short}
                </span>
              </button>
            );
          })}
        </div>

        {/* Emergency CTA */}
        <div className="px-5 mb-5">
          <button
            onClick={() => setSelectedSpec('Emergência')}
            className="w-full flex items-center justify-between active:scale-[0.99] transition-transform text-left"
            style={{
              background: '#0B1410',
              color: '#F7F5EF',
              borderRadius: 24,
              padding: '16px 18px',
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ background: '#E5484D' }}
              >
                <HeartPulse className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ opacity: 0.55 }}>
                  Emergência 24h
                </div>
                <div className="font-bold text-[15px] mt-0.5" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                  Atendimento imediato
                </div>
              </div>
            </div>
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: BRAND, color: '#0B1410' }}
            >
              <Phone className="w-4 h-4" strokeWidth={2.4} />
            </div>
          </button>
        </div>

        {/* Promo slider */}
        <div className="mb-6">
          <div
            ref={promoRef}
            onScroll={onPromoScroll}
            className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory px-5 gap-3"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {promoSlides.map((slide) => (
              <div
                key={slide.id}
                className="snap-start flex-shrink-0 w-full relative overflow-hidden"
                style={{
                  background: slide.bg,
                  color: slide.fg,
                  borderRadius: 26,
                  minHeight: 148,
                }}
              >
                <div className="p-5 flex flex-col justify-between h-full">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.26em]" style={{ opacity: 0.75 }}>
                      {slide.eyebrow}
                    </span>
                  </div>
                  <div className="mt-3">
                    <h3
                      className="font-bold leading-[1.05]"
                      style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 20, letterSpacing: '-0.02em' }}
                    >
                      {slide.title}
                    </h3>
                    <p className="text-[12px] mt-1.5" style={{ opacity: 0.75 }}>
                      {slide.subtitle}
                    </p>
                  </div>
                  <div className="mt-3">
                    <span
                      className="inline-block text-[10px] font-bold uppercase tracking-[0.22em] px-3 py-1.5 rounded-full"
                      style={{ background: `${slide.fg}1A`, border: `1px solid ${slide.fg}40` }}
                    >
                      {slide.cta}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-1.5 mt-3">
            {promoSlides.map((_, i) => (
              <span
                key={i}
                className="block rounded-full transition-all"
                style={{
                  width: promoIndex === i ? 18 : 6,
                  height: 6,
                  background: promoIndex === i ? INK : `${INK}33`,
                }}
              />
            ))}
          </div>
        </div>

        {/* Vets list */}
        <div className="px-5">
          <div className="flex items-end justify-between mb-3">
            <h2
              className="font-bold"
              style={{
                fontFamily: 'Space Grotesk, sans-serif',
                fontSize: 22,
                letterSpacing: '-0.02em',
              }}
            >
              Perto de você
            </h2>
            <span className="text-[11px]" style={{ opacity: 0.55 }}>
              {filteredVets.length} {filteredVets.length === 1 ? 'clínica' : 'clínicas'}
            </span>
          </div>

          {filteredVets.length === 0 ? (
            <div
              className="text-center py-14"
              style={{ background: PAPER, border: `1px dashed ${INK}33`, borderRadius: 24 }}
            >
              <div
                className="w-14 h-14 rounded-full mx-auto flex items-center justify-center mb-4"
                style={{ background: BRAND, color: '#0B1410' }}
              >
                <Stethoscope className="w-6 h-6" strokeWidth={2.2} />
              </div>
              <h3
                className="font-bold mb-1.5"
                style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 18, letterSpacing: '-0.01em' }}
              >
                Nada encontrado
              </h3>
              <p className="text-[12px]" style={{ opacity: 0.6 }}>
                Tente outra especialidade ou busca.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredVets.map((vet) => (
                <button
                  key={vet.id}
                  className="w-full flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
                  style={{
                    background: PAPER,
                    border: `1px solid ${INK}1A`,
                    borderRadius: 22,
                    padding: 12,
                  }}
                >
                  <div
                    className="w-[72px] h-[72px] rounded-2xl flex-shrink-0 flex items-center justify-center"
                    style={{ background: vet.tint }}
                  >
                    <ShieldCheck className="w-7 h-7" style={{ color: '#0B1410', opacity: 0.7 }} strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <h3
                        className="font-bold truncate text-[15px]"
                        style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.01em' }}
                      >
                        {vet.name}
                      </h3>
                    </div>
                    <p className="text-[11.5px] truncate" style={{ opacity: 0.6 }}>
                      {vet.specialty}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px]" style={{ opacity: 0.8 }}>
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3 fill-current" style={{ color: '#F5A524' }} />
                        <strong style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{vet.rating}</strong>
                        <span style={{ opacity: 0.6 }}>({vet.reviews})</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {vet.distance}
                      </span>
                      <span
                        className="flex items-center gap-1 font-semibold"
                        style={{ color: vet.open ? BRAND : '#E5484D' }}
                      >
                        <Clock className="w-3 h-3" />
                        {vet.open ? 'Aberto' : 'Fechado'}
                      </span>
                    </div>
                  </div>
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: BRAND, color: '#0B1410' }}
                  >
                    <ArrowUpRight className="w-4 h-4" strokeWidth={2.4} />
                  </div>
                </button>
              ))}
            </div>
          )}

          <p className="text-center text-[10.5px] mt-5" style={{ opacity: 0.45 }}>
            * Clínicas exibidas são exemplos. Em breve integração com parceiros reais.
          </p>
        </div>
      </div>
      <BottomNavigation />
    </div>
  );
};

export default Veterinario;
