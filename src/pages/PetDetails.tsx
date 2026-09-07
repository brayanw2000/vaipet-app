import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { DocumentUpload } from '@/components/DocumentUpload';
import { DocumentList } from '@/components/DocumentList';
import { ArrowLeft, Edit3, Syringe, FileText, Plus, User, MapPin, Award, Trash2, Heart, Weight, Clock, PawPrint, ChevronRight, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { PetPhotoManager, PetPhotoManagerActions, PetPhotoManagerHandle } from '@/components/PetPhotoManager';
import { WalkDetailsModal } from '@/components/WalkDetailsModal';
import { useHomeTheme } from '@/hooks/useHomeTheme';

const BRAND = '#31D880';

interface Pet {
  id: string;
  name: string;
  breed: string;
  age: number;
  avatar_url?: string;
  behavioral_notes?: string;
  weight?: number;
  gender?: string;
  medical_info?: string;
  emergency_contact?: string;
  created_at: string;
}

const slugify = (name: string) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

export const PetDetails = () => {
  const { name: petSlug } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { palette } = useHomeTheme();
  const photoManagerRef = useRef<PetPhotoManagerHandle>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const PAPER = palette.paper;
  const INK = palette.ink;
  const [pet, setPet] = useState<Pet | null>(null);
  const [loading, setLoading] = useState(true);
  const [showVaccinationUpload, setShowVaccinationUpload] = useState(false);
  const [showMedicalUpload, setShowMedicalUpload] = useState(false);
  const [refreshDocuments, setRefreshDocuments] = useState(0);
  const [walkHistory, setWalkHistory] = useState<any[]>([]);
  const [petPhotos, setPetPhotos] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedWalk, setSelectedWalk] = useState<any>(null);
  const [showWalkDetails, setShowWalkDetails] = useState(false);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'info' | 'docs' | 'history'>('info');

  useEffect(() => {
    if (petSlug && user) fetchPetBySlug();
  }, [petSlug, user]);

  useEffect(() => {
    if (pet) {
      fetchWalkHistory();
      fetchPetPhotos();
    }
  }, [pet]);

  const fetchPetBySlug = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('pets')
        .select('*')
        .eq('owner_id', user?.id)
        .eq('is_active', true);

      if (error) throw error;

      // Find pet matching the slug
      const found = data?.find(p => slugify(p.name) === petSlug);
      if (!found) {
        // Fallback: try treating slug as UUID for backwards compatibility
        const { data: byId } = await supabase.from('pets').select('*').eq('id', petSlug || '').eq('owner_id', user?.id).single();
        if (byId) {
          // Redirect to name-based URL
          navigate(`/pet/${slugify(byId.name)}`, { replace: true });
          setPet(byId);
        } else {
          navigate('/');
        }
        return;
      }
      setPet(found);
    } catch {
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const fetchWalkHistory = async () => {
    if (!pet) return;
    const { data } = await supabase
      .from('walk_sessions')
      .select('*')
      .eq('pet_id', pet.id)
      .eq('current_status', 'completed')
      .order('created_at', { ascending: false })
      .limit(5);

    if (data) {
      setWalkHistory(data.map(s => ({
        ...s,
        provider: { full_name: s.walker_name || 'Pet Walker' },
        total_price: s.total_price_cents ? s.total_price_cents / 100 : 0,
      })));
    }
  };

  const fetchPetPhotos = async () => {
    if (!pet || !user) return;
    try {
      const { data: files } = await supabase.storage
        .from('pet-photos')
        .list(`${user.id}/${pet.id}/`, { limit: 100 });

      const urls = files?.map(f => {
        const { data: { publicUrl } } = supabase.storage.from('pet-photos').getPublicUrl(`${user.id}/${pet.id}/${f.name}`);
        return publicUrl;
      }) || [];

      setPetPhotos(urls.length ? urls : pet.avatar_url ? [pet.avatar_url] : []);
    } catch {
      if (pet.avatar_url) setPetPhotos([pet.avatar_url]);
    }
  };

  useEffect(() => {
    if (petPhotos.length > 1) {
      const interval = setInterval(() => setCurrentPhotoIndex(p => (p + 1) % petPhotos.length), 4000);
      return () => clearInterval(interval);
    }
  }, [petPhotos.length]);

  const handleDeletePet = async () => {
    if (!pet || !user) return;
    setIsDeleting(true);
    try {
      await supabase.from('pets').delete().eq('id', pet.id).eq('owner_id', user.id);
      navigate('/');
    } catch (err) {
      console.error('Delete error:', err);
    } finally { setIsDeleting(false); }
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Ontem';
    if (diff < 7) return `Há ${diff} dias`;
    return d.toLocaleDateString('pt-BR');
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: PAPER }}
      >
        <div
          className="w-10 h-10 rounded-full border-2 animate-spin"
          style={{ borderColor: `${INK}26`, borderTopColor: BRAND }}
        />
      </div>
    );
  }

  if (!pet) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-3"
        style={{ background: PAPER, color: INK }}
      >
        <PawPrint className="w-12 h-12" style={{ opacity: 0.25 }} />
        <p className="font-medium" style={{ opacity: 0.6 }}>Pet não encontrado</p>
        <Button variant="outline" onClick={() => navigate('/')}>Voltar</Button>
      </div>
    );
  }

  const genderLabel = pet.gender === 'male' ? 'Macho' : pet.gender === 'female' ? 'Fêmea' : pet.gender || 'N/A';

  return (
    <div
      className="min-h-screen max-w-md mx-auto relative shadow-2xl overflow-hidden"
      style={{ background: PAPER, color: INK, fontFamily: 'DM Sans, sans-serif' }}
    >
      {/* Hero section */}
      <div className="relative h-[420px] overflow-hidden">
        {petPhotos.length > 0 ? (
          <img
            src={petPhotos[currentPhotoIndex]}
            alt={pet.name}
            className="absolute inset-0 w-full h-full object-cover transition-all duration-700"
          />
        ) : (
          <div
            className="absolute inset-0 w-full h-full flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${BRAND}, #0B1410)` }}
          >
            <PawPrint className="w-20 h-20" style={{ color: '#F7F5EF', opacity: 0.45 }} />
          </div>
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(11,20,16,0.5) 0%, rgba(11,20,16,0) 40%, rgba(11,20,16,0.85) 100%)' }} />

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 z-30 px-5 pt-6 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            aria-label="Voltar"
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform bg-white/20 backdrop-blur-md border border-white/10"
            style={{ color: '#F7F5EF' }}
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2.2} />
          </button>
          
          <div className="flex gap-2">
            <PetPhotoManagerActions 
              uploading={photoUploading} 
              onAddClick={() => photoManagerRef.current?.triggerFileInput()}
              onDeleteClick={() => photoManagerRef.current?.deleteCurrentPhoto()}
              hasPhotos={petPhotos.length > 0}
            />
            
            <button
              onClick={() => navigate(`/add-pet?edit=${pet.id}`)}
              aria-label="Editar perfil"
              className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{ background: BRAND, color: '#0B1410' }}
            >
              <Edit3 className="w-4 h-4" strokeWidth={2.4} />
            </button>
          </div>
        </div>

        {/* Pet Photo Manager Component */}
        <PetPhotoManager
          ref={photoManagerRef}
          petId={pet.id}
          photos={petPhotos}
          currentIndex={currentPhotoIndex}
          onPhotosUpdate={setPetPhotos}
          onIndexChange={setCurrentPhotoIndex}
          onUploadingChange={setPhotoUploading}
        />

        {/* Pet name overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-12 z-10">
          <h1
            className="font-bold leading-[0.9]"
            style={{
              color: '#F7F5EF',
              fontFamily: 'Space Grotesk, sans-serif',
              fontSize: 'clamp(42px, 14vw, 56px)',
              letterSpacing: '-0.04em',
              textShadow: '0 2px 10px rgba(0,0,0,0.2)',
            }}
          >
            {pet.name}
          </h1>
          <p
            className="text-[14px] font-medium mt-2.5 flex items-center gap-2"
            style={{ color: '#F7F5EF', opacity: 0.85 }}
          >
            <span className="bg-white/10 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/10">{pet.breed}</span>
          </p>
        </div>

      </div>

      {/* Content */}
      <div
        className="rounded-t-[32px] -mt-10 relative z-20 pb-10"
        style={{ background: PAPER }}
      >
        {/* Quick stats grid */}
        <div className="px-5 pt-8">
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: User, label: 'Sexo', value: genderLabel, color: '#31D880' },
              { icon: Weight, label: 'Peso', value: `${pet.weight || '—'} kg`, color: '#31D880' },
              { icon: Heart, label: 'Idade', value: `${pet.age || '—'} ${pet.age === 1 ? 'ano' : 'anos'}`, color: '#31D880' },
              { icon: Award, label: 'Passeios', value: walkHistory.length.toString(), color: '#31D880' },
            ].map((stat, i) => (
              <div
                key={i}
                className="flex items-center gap-4 p-4"
                style={{
                  background: `${INK}05`,
                  borderRadius: 24,
                  border: `1px solid ${INK}0D`,
                }}
              >
                <div 
                  className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: `${stat.color}10`, border: `1px solid ${stat.color}15` }}
                >
                  <stat.icon className="w-5 h-5" style={{ color: stat.color }} strokeWidth={2} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider opacity-40 mb-0.5">{stat.label}</p>
                  <p className="text-[15px] font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{stat.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tab bar */}
        <div className="px-5 mt-8 mb-6">
          <div
            className="flex p-1.5"
            style={{
              background: `${INK}0A`,
              borderRadius: 20,
            }}
          >
            {[
              { key: 'info' as const, label: 'Sobre' },
              { key: 'docs' as const, label: 'Documentos' },
              { key: 'history' as const, label: 'Histórico' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex-1 py-3 rounded-[14px] text-[13px] font-bold transition-all"
                style={{
                  background: activeTab === tab.key ? INK : 'transparent',
                  color: activeTab === tab.key ? PAPER : INK,
                  opacity: activeTab === tab.key ? 1 : 0.5,
                  fontFamily: 'Space Grotesk, sans-serif',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5">
          {/* Info tab */}
          {activeTab === 'info' && (
            <div className="space-y-4">
              {pet.behavioral_notes && (
                <div 
                  className="p-5"
                  style={{ background: `${INK}05`, borderRadius: 24, border: `1px solid ${INK}0D` }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${BRAND}15` }}>
                      <Heart className="w-4 h-4" style={{ color: BRAND }} strokeWidth={2.2} />
                    </div>
                    <h4 className="text-[11px] font-bold uppercase tracking-wider opacity-40">Temperamento</h4>
                  </div>
                  <p className="text-[15px] font-medium leading-relaxed opacity-80">{pet.behavioral_notes}</p>
                </div>
              )}

              {pet.medical_info && (
                <div 
                  className="p-5"
                  style={{ background: `${INK}05`, borderRadius: 24, border: `1px solid ${INK}0D` }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${BRAND}15` }}>
                      <Syringe className="w-4 h-4" style={{ color: BRAND }} strokeWidth={2.2} />
                    </div>
                    <h4 className="text-[11px] font-bold uppercase tracking-wider opacity-40">Saúde</h4>
                  </div>
                  <p className="text-[15px] font-medium leading-relaxed opacity-80">{pet.medical_info}</p>
                </div>
              )}

              {pet.emergency_contact && (
                <div 
                  className="p-5"
                  style={{ background: `${INK}05`, borderRadius: 24, border: `1px solid ${INK}0D` }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${BRAND}15` }}>
                      <MapPin className="w-4 h-4" style={{ color: BRAND }} strokeWidth={2.2} />
                    </div>
                    <h4 className="text-[11px] font-bold uppercase tracking-wider opacity-40">Contato de Emergência</h4>
                  </div>
                  <p className="text-[15px] font-medium leading-relaxed opacity-80">{pet.emergency_contact}</p>
                </div>
              )}

              {!pet.behavioral_notes && !pet.medical_info && !pet.emergency_contact && (
                <div
                  className="text-center py-14"
                  style={{ background: `${INK}03`, border: `1px dashed ${INK}15`, borderRadius: 32 }}
                >
                  <div
                    className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4"
                    style={{ background: `${BRAND}15`, color: '#0B1410' }}
                  >
                    <PawPrint className="w-6 h-6" strokeWidth={2} style={{ color: BRAND }} />
                  </div>
                  <p
                    className="font-bold text-[16px]"
                    style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                  >
                    Perfil em construção
                  </p>
                  <p className="text-[13px] opacity-50 mt-1 max-w-[200px] mx-auto">
                    Adicione detalhes sobre o temperamento e saúde do seu pet.
                  </p>
                  <button
                    onClick={() => navigate(`/add-pet?edit=${pet.id}`)}
                    className="mt-6 px-6 py-2.5 rounded-full text-[12px] font-bold uppercase tracking-wider"
                    style={{ background: BRAND, color: '#0B1410' }}
                  >
                    Completar Perfil
                  </button>
                </div>
              )}

              {/* Delete section */}
              <div className="pt-8">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      className="w-full py-4 text-[13px] font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                      style={{
                        borderRadius: 20,
                        background: '#E5484D0A',
                        border: '1px solid #E5484D22',
                        color: '#E5484D',
                        fontFamily: 'Space Grotesk, sans-serif',
                      }}
                      disabled={isDeleting}
                    >
                      <Trash2 className="w-4 h-4" />
                      {isDeleting ? 'Excluindo...' : 'Remover este Pet'}
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-[24px] max-w-[340px]">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-center">Excluir {pet.name}?</AlertDialogTitle>
                      <AlertDialogDescription className="text-center">
                        Esta ação não pode ser desfeita. Todos os dados serão removidos permanentemente.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-row gap-2">
                      <AlertDialogCancel className="flex-1 rounded-xl m-0">Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeletePet} className="flex-1 rounded-xl m-0 bg-destructive text-destructive-foreground">
                        Excluir
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}

          {/* Documents tab */}
          {activeTab === 'docs' && (
            <div className="space-y-4">
              {/* Vaccination */}
              <div style={{ background: PAPER, border: `1px solid ${INK}1A`, borderRadius: 22, padding: 16 }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center"
                      style={{ background: `${BRAND}26` }}
                    >
                      <Syringe className="w-5 h-5" style={{ color: '#0B1410' }} strokeWidth={2.2} />
                    </div>
                    <div>
                      <p className="text-[14px] font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Vacinação</p>
                      <p className="text-[11px]" style={{ opacity: 0.6 }}>Carteirinha de vacinas</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowVaccinationUpload(!showVaccinationUpload)}
                    aria-label="Adicionar vacina"
                    className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                    style={{ background: BRAND, color: '#0B1410' }}
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.4} />
                  </button>
                </div>
                {showVaccinationUpload && (
                  <div className="mb-3">
                    <DocumentUpload petId={pet.id} documentType="vaccination_card" onUploadComplete={() => { setShowVaccinationUpload(false); setRefreshDocuments(p => p + 1); }} />
                  </div>
                )}
                <DocumentList petId={pet.id} documentType="vaccination_card" onDocumentDeleted={() => setRefreshDocuments(p => p + 1)} key={`vac-${refreshDocuments}`} />
              </div>

              {/* Medical docs */}
              <div style={{ background: PAPER, border: `1px solid ${INK}1A`, borderRadius: 22, padding: 16 }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center"
                      style={{ background: `${BRAND}26` }}
                    >
                      <FileText className="w-5 h-5" style={{ color: '#0B1410' }} strokeWidth={2.2} />
                    </div>
                    <div>
                      <p className="text-[14px] font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Documentos</p>
                      <p className="text-[11px]" style={{ opacity: 0.6 }}>Exames e laudos</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowMedicalUpload(!showMedicalUpload)}
                    aria-label="Adicionar documento"
                    className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                    style={{ background: BRAND, color: '#0B1410' }}
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.4} />
                  </button>
                </div>
                {showMedicalUpload && (
                  <div className="mb-3">
                    <DocumentUpload petId={pet.id} documentType="medical_document" onUploadComplete={() => { setShowMedicalUpload(false); setRefreshDocuments(p => p + 1); }} />
                  </div>
                )}
                <DocumentList petId={pet.id} documentType="medical_document" onDocumentDeleted={() => setRefreshDocuments(p => p + 1)} key={`med-${refreshDocuments}`} />
              </div>
            </div>
          )}

          {/* History tab */}
          {activeTab === 'history' && (
            <div>
              {walkHistory.length > 0 ? (
                <div className="space-y-2">
                  {walkHistory.map(walk => (
                    <button
                      key={walk.id}
                      onClick={() => { setSelectedWalk(walk); setShowWalkDetails(true); }}
                      className="w-full flex items-center gap-3 active:scale-[0.99] transition-transform text-left"
                      style={{ background: PAPER, border: `1px solid ${INK}1A`, borderRadius: 20, padding: 14 }}
                    >
                      <div
                        className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: `${BRAND}26` }}
                      >
                        <PawPrint className="w-5 h-5" style={{ color: '#0B1410' }} strokeWidth={2.2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold truncate" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                          {walk.provider?.full_name || walk.walker_name || 'Pet Walker'}
                        </p>
                        <p className="text-[11.5px]" style={{ opacity: 0.6 }}>
                          {formatDate(walk.start_time || walk.created_at)} • {walk.actual_duration_minutes || walk.planned_duration_minutes} min
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[14px] font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                          R$ {walk.total_price?.toFixed(0)}
                        </span>
                        <ChevronRight className="w-4 h-4" style={{ opacity: 0.4 }} />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div
                  className="text-center py-12"
                  style={{ border: `1px dashed ${INK}33`, borderRadius: 24 }}
                >
                  <div
                    className="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3"
                    style={{ background: BRAND, color: '#0B1410' }}
                  >
                    <Clock className="w-5 h-5" strokeWidth={2.2} />
                  </div>
                  <p className="font-bold text-[14px]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                    Nenhum passeio ainda
                  </p>
                  <p className="text-[11.5px] mt-1.5" style={{ opacity: 0.55 }}>
                    O histórico aparece após o primeiro passeio.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <WalkDetailsModal walk={selectedWalk} isOpen={showWalkDetails} onClose={() => setShowWalkDetails(false)} />
    </div>
  );
};
