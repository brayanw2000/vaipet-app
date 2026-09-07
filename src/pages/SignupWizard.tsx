import React, { useState, useRef, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Camera, User, ArrowLeft, ChevronRight, Check, PawPrint, Search, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

const TOTAL_STEPS = 5;

const DOG_BREEDS = [
  "Akita", "American Bully", "American Pit Bull Terrier", "American Staffordshire Terrier",
  "Basset Hound", "Beagle", "Bernese Mountain Dog", "Bichon Frisé", "Blue Heeler",
  "Border Collie", "Boston Terrier", "Boxer", "Buldogue Campeiro", "Buldogue Francês",
  "Buldogue Inglês", "Bull Terrier", "Cane Corso", "Cavalier King Charles Spaniel",
  "Chihuahua", "Chow Chow", "Cocker Spaniel Americano", "Cocker Spaniel Inglês",
  "Collie", "Corgi (Pembroke)", "Corgi (Cardigan)", "Dachshund (Salsicha)",
  "Dálmata", "Doberman", "Dogo Argentino", "Fila Brasileiro",
  "Fox Paulistinha", "Golden Retriever", "Husky Siberiano",
  "Jack Russell Terrier", "Labrador Retriever", "Lhasa Apso",
  "Lulu da Pomerânia (Spitz Alemão)", "Maltês", "Mastiff Inglês", "Mastim Tibetano",
  "Ovelheiro Gaúcho", "Pastor Alemão", "Pastor Australiano", "Pastor Belga Malinois",
  "Pastor de Shetland", "Pinscher Miniatura", "Pointer Inglês",
  "Poodle (Toy)", "Poodle (Miniatura)", "Poodle (Standard)", "Pug",
  "Rottweiler", "Samoieda", "São Bernardo", "Schnauzer (Miniatura)", "Schnauzer (Standard)",
  "Setter Irlandês", "Shar-Pei", "Shiba Inu", "Shih Tzu",
  "Staffordshire Bull Terrier", "Terra Nova", "Vira-Lata (SRD)",
  "Weimaraner", "West Highland White Terrier", "Whippet",
  "Yorkshire Terrier"
];

const CAT_BREEDS = [
  "Angorá", "Bengal", "British Shorthair", "Chartreux", "Exótico",
  "Maine Coon", "Munchkin", "Persa", "Ragdoll", "Russian Blue",
  "Scottish Fold", "Siamês", "Sphynx", "Vira-Lata (SRD)"
];

const PET_SIZES = [
  { value: 'mini', label: 'Mini (até 5kg)' },
  { value: 'pequeno', label: 'Pequeno (5-10kg)' },
  { value: 'medio', label: 'Médio (10-25kg)' },
  { value: 'grande', label: 'Grande (25-45kg)' },
  { value: 'gigante', label: 'Gigante (45kg+)' },
];

const StepIndicator = ({ current, total }: { current: number; total: number }) => (
  <div className="flex gap-2 justify-center mb-8">
    {Array.from({ length: total }).map((_, i) => (
      <div
        key={i}
        className="h-1.5 rounded-full transition-all duration-300"
        style={{
          width: i === current ? 32 : 16,
          backgroundColor: i <= current ? '#F14A00' : '#E5E7EB',
        }}
      />
    ))}
  </div>
);

// Searchable breed selector component
const BreedSelector = ({ 
  value, 
  onChange, 
  petType 
}: { 
  value: string; 
  onChange: (v: string) => void; 
  petType: string;
}) => {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const breeds = petType === 'gato' ? CAT_BREEDS : DOG_BREEDS;

  const filtered = useMemo(() => {
    if (!search.trim()) return breeds;
    const q = search.toLowerCase();
    return breeds.filter(b => b.toLowerCase().includes(q));
  }, [search, breeds]);

  const selectBreed = (b: string) => {
    onChange(b);
    setSearch('');
    setIsOpen(false);
  };

  const handleCustomBreed = () => {
    if (search.trim()) {
      onChange(search.trim());
      setSearch('');
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          ref={inputRef}
          placeholder="Buscar raça..."
          value={value && !isOpen ? value : search}
          onChange={e => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
            if (value) onChange('');
          }}
          onFocus={() => setIsOpen(true)}
          className="h-12 rounded-xl border-none bg-[#F2F2F7] focus:bg-[#E5E5EA] pl-10 pr-10 text-sm transition-colors"
        />
        {value && (
          <button 
            onClick={() => { onChange(''); setSearch(''); setIsOpen(true); inputRef.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <ScrollArea className="max-h-48">
            {filtered.length > 0 ? (
              filtered.map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => selectBreed(b)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                >
                  {b}
                </button>
              ))
            ) : (
              <div className="p-3 space-y-2">
                <p className="text-xs text-gray-400 text-center">Raça não encontrada</p>
                {search.trim() && (
                  <button
                    type="button"
                    onClick={handleCustomBreed}
                    className="w-full text-left px-4 py-2.5 text-sm rounded-lg font-medium"
                    style={{ backgroundColor: '#FFF5F0', color: '#F14A00' }}
                  >
                    + Adicionar "{search.trim()}" como nova raça
                  </button>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* Backdrop to close */}
      {isOpen && <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />}
    </div>
  );
};

const SignupWizard = ({ initialIntent: propIntent }: { initialIntent?: 'pet_owner' | 'petwalker' }) => {
  const [signupIntent] = useState<'pet_owner' | 'petwalker'>(() => {
    const params = new URLSearchParams(window.location.search);
    const intentParam = params.get('intent');
    if (intentParam === 'petwalker' || intentParam === 'pet_owner') {
      return intentParam as 'pet_owner' | 'petwalker';
    }
    return propIntent || 'pet_owner';
  });
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Step 0: Name + Email
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');

  // Step 1: Phone + Password
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 2: Profile photo
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [profilePreview, setProfilePreview] = useState('');
  const profileInputRef = useRef<HTMLInputElement>(null);

  // Step 3: Pet info
  const [petType, setPetType] = useState('cachorro');
  const [petName, setPetName] = useState('');
  const [breed, setBreed] = useState('');
  const [age, setAge] = useState('');
  const [ageUnit, setAgeUnit] = useState('anos');
  const [temperament, setTemperament] = useState('');
  const [gender, setGender] = useState('');
  const [petSize, setPetSize] = useState('');
  const [weight, setWeight] = useState('');
  const [castrated, setCastrated] = useState('');
  const [medicalInfo, setMedicalInfo] = useState('');
  const [behavioralNotes, setBehavioralNotes] = useState('');

  // Step 4: Pet photo
  const [petPhotos, setPetPhotos] = useState<File[]>([]);
  const petInputRef = useRef<HTMLInputElement>(null);

  const formatPhoneNumber = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits.length > 0 ? `(${digits}` : '';
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const handleProfilePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { toast.error('Máximo 5MB'); return; }
      setProfilePhoto(file);
      const reader = new FileReader();
      reader.onload = (ev) => setProfilePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handlePetPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (petPhotos.length + files.length > 3) { toast.error('Máximo 3 fotos'); return; }
    setPetPhotos(prev => [...prev, ...files].slice(0, 3));
  };

  const canGoNext = (): boolean => {
    switch (step) {
      case 0: return !!fullName.trim() && !!email.trim();
      case 1: return !!phone.trim() && password.length >= 6 && password === confirmPassword;
      case 2: return true;
      case 3: return true;
      case 4: return true;
      default: return false;
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/`;
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: { 
            full_name: fullName, 
            phone,
            signup_intent: signupIntent
          }
        }
      });

      if (authError) {
        console.error('[SignupWizard] Auth error:', authError);
        toast.error(authError.message);
        setLoading(false);
        return;
      }
      
      const user = authData.user;
      if (!user) { toast.error('Erro ao criar conta'); setLoading(false); return; }

      if (!authData.session) {
        toast.success('Conta criada! Verifique seu email para confirmar e depois faça login.');
        navigate('/auth');
        return;
      }

      let avatarUrl: string | null = null;
      if (profilePhoto) {
        const fileExt = profilePhoto.name.split('.').pop();
        const fileName = `${user.id}/avatars/${Date.now()}.${fileExt}`;
        const { data, error } = await supabase.storage
          .from('pet-photos')
          .upload(fileName, profilePhoto, { cacheControl: '3600', upsert: true });
        if (!error && data) {
          const { data: { publicUrl } } = supabase.storage.from('pet-photos').getPublicUrl(data.path);
          avatarUrl = publicUrl;
        }
      }

      const profileUpdate: {
        phone: string;
        onboarding_completed: boolean;
        updated_at: string;
        avatar_url?: string;
      } = {
        phone,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      };
      if (avatarUrl) profileUpdate.avatar_url = avatarUrl;
      await supabase.from('profiles').update(profileUpdate).eq('id', user.id);

      // Build behavioral notes with extra info
      const notes = [
        temperament && `Temperamento: ${temperament}`,
        castrated && `Castrado: ${castrated}`,
        petSize && `Porte: ${petSize}`,
        behavioralNotes && `Comportamento: ${behavioralNotes}`,
      ].filter(Boolean).join(' | ');

      // Only create pet if user filled in pet name
      if (petName.trim()) {
        const { data: petData, error: petError } = await supabase
          .from('pets')
          .insert({
            owner_id: user.id,
            name: petName,
            breed: breed ? `${petType === 'gato' ? '🐱 ' : '🐶 '}${breed}` : 'Não informada',
            age: age ? (ageUnit === 'meses' ? Math.round(parseInt(age) / 12 * 10) / 10 : parseInt(age)) : null,
            behavioral_notes: notes || temperament || null,
            gender: gender || null,
            weight: weight ? parseFloat(weight) : null,
            medical_info: medicalInfo || null,
            is_active: true
          })
          .select()
          .single();

        if (petError) {
          console.error('Erro ao cadastrar pet:', petError);
        }

        if (petData && petPhotos.length > 0) {
          for (let i = 0; i < petPhotos.length; i++) {
            const photo = petPhotos[i];
            const fileExt = photo.name.split('.').pop();
            const fileName = `${user.id}/pets/${petData.id}/${Date.now()}-${i}.${fileExt}`;
            const { error: uploadError } = await supabase.storage.from('pet-photos').upload(fileName, photo);
            if (!uploadError && i === 0) {
              const { data: urlData } = supabase.storage.from('pet-photos').getPublicUrl(fileName);
              await supabase.from('pets').update({ avatar_url: urlData.publicUrl }).eq('id', petData.id);
            }
          }
        }
      }

      toast.success('Conta criada com sucesso! 🎉');
      if (signupIntent === 'petwalker') {
        navigate('/petwalker/inscricao');
      } else {
        navigate('/');
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro ao criar conta');
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    if (!canGoNext()) return;
    if (step < TOTAL_STEPS - 1) {
      if (step === 2 && signupIntent === 'petwalker') {
        handleComplete();
        return;
      }
      setStep(step + 1);
    } else {
      handleComplete();
    }
  };

  const inputClasses = "h-12 rounded-xl border-none bg-[#F2F2F7] focus:bg-[#E5E5EA] px-4 text-sm transition-colors";

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="px-4 pt-6 pb-2 flex items-center">
        {step > 0 ? (
          <Button variant="ghost" size="icon" onClick={() => setStep(step - 1)} className="mr-2">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" onClick={() => navigate('/auth')} className="mr-2">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        )}
        <span className="text-xs text-gray-400 ml-auto">Passo {step + 1} de {TOTAL_STEPS}</span>
      </div>

      <div className="flex-1 px-6 pb-6 overflow-y-auto">
        <StepIndicator current={step} total={TOTAL_STEPS} />

        {/* Step 0: Name + Email */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: '#0B1410' }}>Vamos começar!</h2>
              <p className="text-sm text-gray-500">Como podemos te chamar?</p>
            </div>
            <div className="space-y-3">
              <Input placeholder="Seu nome completo" value={fullName} onChange={e => setFullName(e.target.value)} className={inputClasses} required />
              <Input type="email" placeholder="Seu melhor e-mail" value={email} onChange={e => setEmail(e.target.value)} className={inputClasses} required />
            </div>
          </div>
        )}

        {/* Step 1: Phone + Password */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: '#0B1410' }}>Segurança primeiro</h2>
              <p className="text-sm text-gray-500">Adicione seu telefone e crie uma senha</p>
            </div>
            <div className="space-y-3">
              <Input type="tel" placeholder="(11) 99999-9999" value={phone} onChange={e => setPhone(formatPhoneNumber(e.target.value))} className={inputClasses} required />
              <Input type="password" placeholder="Crie uma senha (mín. 6 caracteres)" value={password} onChange={e => setPassword(e.target.value)} className={inputClasses} minLength={6} required />
              <Input type="password" placeholder="Confirme a senha" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={inputClasses} minLength={6} required />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-500">As senhas não coincidem</p>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Profile photo */}
        {step === 2 && (
          <div className="space-y-6 flex flex-col items-center">
            <div className="text-center">
              <h2 className="text-xl font-bold mb-1" style={{ color: '#0B1410' }}>Sua foto de perfil</h2>
              <p className="text-sm text-gray-500">Mostre quem você é! (opcional)</p>
            </div>
            <div className="relative">
              <div
                className="w-32 h-32 rounded-full overflow-hidden border-4 flex items-center justify-center cursor-pointer"
                style={{ borderColor: '#F14A00', backgroundColor: '#FFF5F0' }}
                onClick={() => profileInputRef.current?.click()}
              >
                {profilePreview ? (
                  <img src={profilePreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-14 h-14" style={{ color: '#F14A00' }} />
                )}
              </div>
              <button
                onClick={() => profileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-10 h-10 rounded-full flex items-center justify-center shadow-lg text-white"
                style={{ backgroundColor: '#F14A00' }}
              >
                <Camera className="w-5 h-5" />
              </button>
              <input ref={profileInputRef} type="file" accept="image/*" onChange={handleProfilePhoto} className="hidden" />
            </div>
            <p className="text-xs text-gray-400">Toque para adicionar uma foto</p>
          </div>
        )}

        {/* Step 3: Pet info - expanded */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-xl font-bold mb-1" style={{ color: '#0B1410' }}>Cadastre seu pet 🐾</h2>
              <p className="text-sm text-gray-500">Conta pra gente sobre seu companheiro</p>
            </div>

            {/* Pet type selector */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setPetType('cachorro'); setBreed(''); }}
                className="flex-1 h-11 rounded-xl text-sm font-medium border transition-all"
                style={{
                  backgroundColor: petType === 'cachorro' ? '#F14A00' : 'white',
                  color: petType === 'cachorro' ? 'white' : '#6B7280',
                  borderColor: petType === 'cachorro' ? '#F14A00' : '#E5E7EB',
                }}
              >
                🐶 Cachorro
              </button>
              <button
                type="button"
                onClick={() => { setPetType('gato'); setBreed(''); }}
                className="flex-1 h-11 rounded-xl text-sm font-medium border transition-all"
                style={{
                  backgroundColor: petType === 'gato' ? '#F14A00' : 'white',
                  color: petType === 'gato' ? 'white' : '#6B7280',
                  borderColor: petType === 'gato' ? '#F14A00' : '#E5E7EB',
                }}
              >
                🐱 Gato
              </button>
            </div>

            <div className="space-y-3">
              <Input placeholder="Nome do pet" value={petName} onChange={e => setPetName(e.target.value)} className={inputClasses} required />
              
              <BreedSelector value={breed} onChange={setBreed} petType={petType} />

              <div className="flex gap-2">
                <Input type="number" placeholder="Idade" value={age} onChange={e => setAge(e.target.value)} className={`${inputClasses} flex-1`} required min="1" max={ageUnit === 'anos' ? '30' : '360'} />
                <Select value={ageUnit} onValueChange={setAgeUnit}>
                  <SelectTrigger className={`${inputClasses} w-24`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anos">Anos</SelectItem>
                    <SelectItem value="meses">Meses</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger className={inputClasses}><SelectValue placeholder="Sexo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="macho">Macho</SelectItem>
                    <SelectItem value="femea">Fêmea</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={castrated} onValueChange={setCastrated}>
                  <SelectTrigger className={inputClasses}><SelectValue placeholder="Castrado?" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sim">Sim</SelectItem>
                    <SelectItem value="nao">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Select value={temperament} onValueChange={setTemperament}>
                  <SelectTrigger className={inputClasses}><SelectValue placeholder="Temperamento" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="docil">Dócil</SelectItem>
                    <SelectItem value="brincalhao">Brincalhão</SelectItem>
                    <SelectItem value="calmo">Calmo</SelectItem>
                    <SelectItem value="moderavel">Moderável</SelectItem>
                    <SelectItem value="timido">Tímido</SelectItem>
                    <SelectItem value="protetor">Protetor</SelectItem>
                    <SelectItem value="agressivo">Agressivo</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={petSize} onValueChange={setPetSize}>
                  <SelectTrigger className={inputClasses}><SelectValue placeholder="Porte" /></SelectTrigger>
                  <SelectContent>
                    {PET_SIZES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Input 
                type="number" 
                placeholder="Peso em kg (opcional)" 
                value={weight} 
                onChange={e => setWeight(e.target.value)} 
                className={inputClasses} 
                step="0.1" 
                min="0" 
              />

              <Textarea
                placeholder="Informações médicas relevantes (alergias, medicações...) - opcional"
                value={medicalInfo}
                onChange={e => setMedicalInfo(e.target.value)}
                className="rounded-xl border-gray-200 px-4 py-3 text-sm min-h-[60px] resize-none"
              />

              <Textarea
                placeholder="Notas de comportamento (medo de fogos, late muito...) - opcional"
                value={behavioralNotes}
                onChange={e => setBehavioralNotes(e.target.value)}
                className="rounded-xl border-gray-200 px-4 py-3 text-sm min-h-[60px] resize-none"
              />
            </div>
          </div>
        )}

        {/* Step 4: Final Step (Photo upload disabled) */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="text-center">
              <div 
                className="w-32 h-32 mx-auto rounded-full flex items-center justify-center mb-4"
                style={{ backgroundColor: '#FFF5F0' }}
              >
                <PawPrint className="w-12 h-12" style={{ color: '#F14A00' }} />
              </div>
              <h2 className="text-xl font-bold mb-1" style={{ color: '#0B1410' }}>Quase lá!</h2>
              <p className="text-sm text-gray-500 mb-6">O perfil do {petName || 'seu pet'} está pronto para começar os passeios.</p>
              
              <div className="bg-gray-50 p-6 rounded-2xl text-left border border-gray-100">
                <p className="text-sm text-gray-600 leading-relaxed text-center font-medium">
                  Seu cadastro foi concluído. Clique no botão abaixo para finalizar e entrar no app!
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom buttons */}
      <div className="px-6 pb-8 space-y-3">
        <Button
          onClick={handleNext}
          disabled={loading}
          className="w-full h-12 text-white text-sm font-semibold rounded-xl gap-2"
          style={{ backgroundColor: '#F14A00' }}
        >
          {loading ? 'Criando conta...' : step === TOTAL_STEPS - 1 ? (
            <><Check className="w-4 h-4" /> Finalizar cadastro</>
          ) : (
            <>Continuar <ChevronRight className="w-4 h-4" /></>
          )}
        </Button>
        {(step === 3 || step === 4) && (
          <Button
            variant="ghost"
            onClick={() => {
              if (step === 3) {
                // Skip pet steps entirely - go to complete
                setPetName('');
                setBreed('');
                handleComplete();
              } else {
                handleComplete();
              }
            }}
            disabled={loading}
            className="w-full h-10 text-sm text-gray-400 hover:text-gray-600"
          >
            Pular, cadastrar depois
          </Button>
        )}
      </div>
    </div>
  );
};

export default SignupWizard;
