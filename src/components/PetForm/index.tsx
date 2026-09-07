import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { PetFormFields } from './PetFormFields';
import { PetPhotoUpload } from './PetPhotoUpload';
import { Progress } from '@/components/ui/progress';
import { Heart, Shield, Camera, Info, PawPrint, Sparkles, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface PetFormProps {
  editId?: string | null;
  isEditing: boolean;
}

const slugify = (name: string) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

type GenerationStatus = 'idle' | 'image_processing' | 'model_generating' | 'completed' | 'error';

const fetchBreedPhoto = async (
  breed: string, 
  onStatusChange?: (status: GenerationStatus) => void
): Promise<string | null> => {
  try {
    onStatusChange?.('image_processing');
    const { data, error } = await supabase.functions.invoke('generate-breed-photo', {
      body: { breed },
    });
    
    if (error) {
      console.error('Error fetching breed photo:', error);
      onStatusChange?.('error');
      return null;
    }

    // Trigger 3D model generation in background
    if (data?.photo_url) {
      onStatusChange?.('model_generating');
      supabase.functions.invoke('generate-pet-3d', {
        body: { breed, imageUrl: data.photo_url }
      }).then(({ data: meshyData }) => {
        if (meshyData?.taskId) {
          console.log('Meshy task created:', meshyData.taskId);
          // Poll every 30s
          const poll = setInterval(async () => {
            const { data: pollRes } = await supabase.functions.invoke('process-meshy-task', {
              body: { taskId: meshyData.taskId, breed }
            });
            if (pollRes?.status === 'SUCCEEDED') {
              clearInterval(poll);
              console.log('Meshy task finished: SUCCEEDED');
              onStatusChange?.('completed');
            } else if (pollRes?.status === 'FAILED') {
              clearInterval(poll);
              console.log('Meshy task finished: FAILED');
              onStatusChange?.('error');
            }
          }, 30000);
        } else {
          // If task creation failed but we have image, we consider image part done
          onStatusChange?.('completed');
        }
      }).catch(err => {
        console.error('Meshy trigger error:', err);
        onStatusChange?.('completed'); // Still have the photo
      });
    }

    return data?.photo_url || null;
  } catch (e) {
    console.error('Error generating breed photo:', e);
    onStatusChange?.('error');
    return null;
  }
};

export const PetForm: React.FC<PetFormProps> = ({ editId, isEditing }) => {
  const [step, setStep] = useState(1);
  const totalSteps = 4;
  
  const [petName, setPetName] = useState('');
  const [breed, setBreed] = useState('');
  const [age, setAge] = useState('');
  const [ageUnit, setAgeUnit] = useState('anos');
  const [temperament, setTemperament] = useState('');
  const [gender, setGender] = useState('');
  const [weight, setWeight] = useState('');
  const [medicalInfo, setMedicalInfo] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [petType, setPetType] = useState('cachorro');
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');
  
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isEditing && editId && user) {
      fetchPetData();
    }
  }, [isEditing, editId, user]);

  const fetchPetData = async () => {
    try {
      const { data, error } = await supabase
        .from('pets')
        .select('*')
        .eq('id', editId)
        .eq('owner_id', user?.id)
        .single();

      if (error) {
        console.error('Erro ao buscar pet:', error);
        toast.error('Pet não encontrado');
        navigate('/');
        return;
      }

      setPetName(data.name);
      setBreed(data.breed);
      setAge(data.age?.toString() || '');
      setTemperament(data.behavioral_notes || '');
      setGender(data.gender || '');
      setWeight(data.weight?.toString() || '');
      setMedicalInfo(data.medical_info || '');
      setEmergencyContact(data.emergency_contact || '');
      setCurrentAvatarUrl(data.avatar_url || '');
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao carregar dados do pet');
      navigate('/');
    }
  };

  const uploadPhotos = async (petId: string) => {
    if (photos.length === 0) return [];

    setUploading(true);
    const uploadedUrls: string[] = [];

    try {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const fileExt = photo.name.split('.').pop();
        const fileName = `${user?.id}/pets/${petId}/${Date.now()}-${i}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('pet-photos')
          .upload(fileName, photo);

        if (uploadError) throw uploadError;

        const { data } = supabase.storage
          .from('pet-photos')
          .getPublicUrl(fileName);

        uploadedUrls.push(data.publicUrl);
      }
    } catch (error) {
      console.error('Erro ao fazer upload das fotos:', error);
      toast.error('Erro ao fazer upload das fotos');
    } finally {
      setUploading(false);
    }

    return uploadedUrls;
  };

  const handleNextStep = () => {
    if (step === 1) {
      if (!petName || !breed) {
        toast.error('Preencha o nome e a raça do seu pet');
        return;
      }
    }
    setStep(s => Math.min(s + 1, totalSteps));
  };

  const handleBackStep = () => {
    setStep(s => Math.max(s - 1, 1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!petName || !breed) {
      toast.error('Por favor, preencha os dados básicos do pet');
      setStep(1);
      return;
    }

    setLoading(true);

    try {
      if (isEditing && editId) {
        const updateData: any = {
          name: petName,
          breed: breed,
          age: age ? (ageUnit === 'meses' ? Math.round(parseInt(age) / 12 * 10) / 10 : parseInt(age)) : null,
          behavioral_notes: temperament || null,
          gender: gender || null,
          weight: weight ? parseFloat(weight) : null,
          medical_info: medicalInfo || null,
          emergency_contact: emergencyContact || null,
        };

        if (photos.length > 0) {
          const photoUrls = await uploadPhotos(editId);
          if (photoUrls.length > 0) {
            updateData.avatar_url = photoUrls[0];
          }
        }

        const { error: updateError } = await supabase
          .from('pets')
          .update(updateData)
          .eq('id', editId);

        if (updateError) {
          console.error('Erro ao atualizar pet:', updateError);
          toast.error('Erro ao atualizar pet');
          return;
        }

        toast.success('Pet atualizado com sucesso!');
        navigate(`/pet/${slugify(petName)}`);
      } else {
        // Create pet
        const { data: petData, error: petError } = await supabase
          .from('pets')
          .insert({
            owner_id: user?.id,
            name: petName,
            breed: breed,
            age: age ? (ageUnit === 'meses' ? Math.round(parseInt(age) / 12 * 10) / 10 : parseInt(age)) : null,
            behavioral_notes: temperament || null,
            gender: gender || null,
            weight: weight ? parseFloat(weight) : null,
            medical_info: medicalInfo || null,
            emergency_contact: emergencyContact || null,
            is_active: true
          })
          .select()
          .single();

        if (petError) {
          console.error('Erro ao cadastrar pet:', petError);
          toast.error('Erro ao cadastrar pet');
          return;
        }

        let avatarUrl: string | null = null;

        if (photos.length > 0) {
          const photoUrls = await uploadPhotos(petData.id);
          if (photoUrls.length > 0) {
            avatarUrl = photoUrls[0];
          }
        }

        // If no photo was uploaded, generate breed photo with AI
        if (!avatarUrl) {
          avatarUrl = await fetchBreedPhoto(breed, (status) => {
            setGenerationStatus(status);
          });
        }

        if (avatarUrl) {
          await supabase
            .from('pets')
            .update({ avatar_url: avatarUrl })
            .eq('id', petData.id);
        }

        if (generationStatus === 'idle') {
          toast.success('Pet cadastrado com sucesso!');
          navigate('/');
        }
      }
    } catch (error) {
      console.error('Erro:', error);
      toast.error(isEditing ? 'Erro ao atualizar pet' : 'Erro ao cadastrar pet');
    } finally {
      setLoading(false);
    }
  };

  const renderGenerationOverlay = () => {
    if (generationStatus === 'idle') return null;

    const statusConfig = {
      image_processing: {
        icon: Sparkles,
        title: 'Criando a foto...',
        description: 'Nossa IA está gerando uma foto incrível para o seu pet.',
        color: 'text-accent',
        bgColor: 'bg-accent/10',
        spin: false,
      },
      model_generating: {
        icon: Loader2,
        title: 'Gerando modelo 3D...',
        description: 'Quase pronto! Estamos criando a version 3D para o mapa.',
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/10',
        spin: true,
      },
      completed: {
        icon: CheckCircle2,
        title: 'Tudo pronto!',
        description: 'O pet e seu modelo 3D foram criados com sucesso.',
        color: 'text-green-500',
        bgColor: 'bg-green-500/10',
        spin: false,
      },
      error: {
        icon: AlertCircle,
        title: 'Ops, algo deu errado',
        description: 'Não conseguimos gerar o 3D agora, mas o pet foi salvo!',
        color: 'text-red-500',
        bgColor: 'bg-red-500/10',
        spin: false,
      },
    };

    const config = statusConfig[generationStatus as keyof typeof statusConfig];
    const Icon = config.icon;

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-background/80 backdrop-blur-sm animate-in fade-in duration-300">
        <div className="w-full max-w-sm bg-card border border-border rounded-[40px] p-8 shadow-2xl space-y-6 text-center animate-in zoom-in-95 duration-300">
          <div className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center ${config.bgColor}`}>
            <Icon className={`w-10 h-10 ${config.color} ${config.spin ? 'animate-spin' : ''}`} />
          </div>
          
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-foreground">{config.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {config.description}
            </p>
          </div>

          {(generationStatus === 'completed' || generationStatus === 'error') && (
            <Button 
              onClick={() => navigate('/')}
              className="w-full h-14 rounded-2xl bg-accent text-accent-foreground font-bold shadow-lg shadow-accent/20"
            >
              Continuar
            </Button>
          )}

          {generationStatus !== 'completed' && generationStatus !== 'error' && (
            <div className="flex justify-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderStepHeader = () => {
    const steps = [
      { icon: Info, label: 'Identidade' },
      { icon: PawPrint, label: 'Perfil' },
      { icon: Camera, label: 'Fotos' },
      { icon: Heart, label: 'Saúde' },
    ];

    return (
      <div className="mb-8 space-y-4">
        <div className="flex justify-between items-center px-2">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const isActive = step === i + 1;
            const isDone = step > i + 1;
            return (
              <div key={i} className="flex flex-col items-center gap-1.5 transition-all duration-300">
                <div 
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                    isActive ? 'bg-accent border-accent text-accent-foreground shadow-lg shadow-accent/25 scale-110' : 
                    isDone ? 'bg-accent/20 border-accent/40 text-accent' : 
                    'bg-card border-border/40 text-muted-foreground opacity-50'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-accent' : 'text-muted-foreground opacity-50'}`}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
        <Progress value={(step / totalSteps) * 100} className="h-1.5 bg-accent/10" />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {renderGenerationOverlay()}
      {renderStepHeader()}
      
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="min-h-[320px] animate-in fade-in slide-in-from-right-4 duration-500">
          {step === 1 && (
            <div className="space-y-4">
              <PetFormFields 
                step="identity"
                petName={petName} setPetName={setPetName}
                breed={breed} setBreed={setBreed}
                petType={petType} setPetType={setPetType}
              />
            </div>
          )}
          
          {step === 2 && (
            <div className="space-y-4">
              <PetFormFields 
                step="profile"
                age={age} setAge={setAge}
                ageUnit={ageUnit} setAgeUnit={setAgeUnit}
                temperament={temperament} setTemperament={setTemperament}
                gender={gender} setGender={setGender}
                weight={weight} setWeight={setWeight}
              />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <PetPhotoUpload
                photos={photos}
                setPhotos={setPhotos}
                currentAvatarUrl={currentAvatarUrl}
                isEditing={isEditing}
              />
              <p className="text-center text-xs text-muted-foreground">
                Dica: Se não enviar foto, usaremos IA para gerar uma baseada na raça!
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <PetFormFields 
                step="health"
                medicalInfo={medicalInfo} setMedicalInfo={setMedicalInfo}
                emergencyContact={emergencyContact} setEmergencyContact={setEmergencyContact}
              />
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-6 border-t border-border/10">
          {step > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={handleBackStep}
              className="flex-1 h-14 rounded-2xl font-bold border-2 bg-white text-black active:scale-95 transition-all"
            >
              Voltar
            </Button>
          )}
          
          {step < totalSteps ? (
            <Button
              type="button"
              onClick={handleNextStep}
              className="flex-[2] h-14 rounded-2xl bg-accent text-accent-foreground font-bold shadow-lg shadow-accent/20 active:scale-95 transition-all"
            >
              Próximo
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={loading || uploading}
              className="flex-[2] h-14 rounded-2xl bg-accent text-accent-foreground font-bold shadow-lg shadow-accent/20 active:scale-95 transition-all"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
                  {isEditing ? 'Atualizando...' : 'Finalizando...'}
                </span>
              ) : (
                isEditing ? '✏️ Salvar' : '✅ Finalizar'
              )}
            </Button>
          )}
        </div>

        {step > 1 && step < totalSteps && (
          <button
            type="button"
            onClick={() => setStep(totalSteps)}
            className="w-full text-center text-xs font-medium text-muted-foreground hover:text-accent transition-colors"
          >
            Pular para o final
          </button>
        )}
      </form>
    </div>
  );
};
