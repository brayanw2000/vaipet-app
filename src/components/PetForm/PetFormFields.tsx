import React, { useState, useRef, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, X, Heart, Shield } from 'lucide-react';

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
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
          className="h-12 rounded-2xl border-border/60 bg-white pl-10 pr-10 text-sm text-black shadow-sm focus:shadow-md focus:border-accent/50 transition-all duration-200"
        />
        {value && (
          <button 
            type="button"
            onClick={() => { onChange(''); setSearch(''); setIsOpen(true); inputRef.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1.5 bg-card border border-border rounded-2xl shadow-xl overflow-hidden animate-scale-in">
          <ScrollArea className="max-h-48">
            {filtered.length > 0 ? (
              filtered.map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => selectBreed(b)}
                  className="w-full text-left px-4 py-3 text-sm text-foreground hover:bg-accent/10 active:bg-accent/20 transition-colors"
                >
                  {b}
                </button>
              ))
            ) : (
              <div className="p-4 space-y-2">
                <p className="text-xs text-muted-foreground text-center font-medium">Raça não encontrada</p>
                {search.trim() && (
                  <button
                    type="button"
                    onClick={handleCustomBreed}
                    className="w-full text-left px-4 py-2.5 text-sm rounded-xl font-medium bg-accent/10 text-accent active:bg-accent/20 transition-colors"
                  >
                    + Adicionar "{search.trim()}" como nova raça
                  </button>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {isOpen && <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />}
    </div>
  );
};

const SectionLabel = ({ icon: Icon, label }: { icon: React.ElementType; label: string }) => (
  <div className="flex items-center gap-2 pt-3 pb-1">
    <div className="p-1 rounded-lg bg-accent/10">
      <Icon className="w-3.5 h-3.5 text-accent" />
    </div>
    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
    <div className="flex-1 h-px bg-border/50" />
  </div>
);

interface PetFormFieldsProps {
  step?: 'identity' | 'profile' | 'health';
  petName?: string;
  setPetName?: (value: string) => void;
  breed?: string;
  setBreed?: (value: string) => void;
  petType?: string;
  setPetType?: (value: string) => void;
  age?: string;
  setAge?: (value: string) => void;
  ageUnit?: string;
  setAgeUnit?: (value: string) => void;
  temperament?: string;
  setTemperament?: (value: string) => void;
  gender?: string;
  setGender?: (value: string) => void;
  weight?: string;
  setWeight?: (value: string) => void;
  medicalInfo?: string;
  setMedicalInfo?: (value: string) => void;
  emergencyContact?: string;
  setEmergencyContact?: (value: string) => void;
}

export const PetFormFields: React.FC<PetFormFieldsProps> = ({
  step,
  petName, setPetName,
  breed, setBreed,
  petType, setPetType,
  age, setAge,
  ageUnit, setAgeUnit,
  temperament, setTemperament,
  gender, setGender,
  weight, setWeight,
  medicalInfo, setMedicalInfo,
  emergencyContact, setEmergencyContact
}) => {
  const inputClasses = "h-12 rounded-2xl border-border/60 bg-white text-black px-4 text-sm shadow-sm focus:shadow-md focus:border-accent/50 transition-all duration-200";

  if (step === 'identity') {
    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          {['cachorro', 'gato', 'outro'].map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => { setPetType?.(type); setBreed?.(''); }}
              className={`flex-1 h-12 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all duration-200 active:scale-[0.95] ${
                petType === type 
                  ? 'bg-accent text-accent-foreground border-accent shadow-lg shadow-accent/20' 
                  : 'bg-white text-black border-border/40 shadow-sm hover:border-accent/30'
              }`}

            >
              {type === 'cachorro' ? 'Cão' : type === 'gato' ? 'Gato' : 'Outro'}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Nome</label>
          <Input
            type="text"
            placeholder="Ex: Pingo"
            value={petName}
            onChange={(e) => setPetName?.(e.target.value)}
            className={inputClasses}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Raça</label>
          {petType !== 'outro' ? (
            <BreedSelector value={breed || ''} onChange={(v) => setBreed?.(v)} petType={petType || 'cachorro'} />
          ) : (
            <Input
              type="text"
              placeholder="Qual a espécie/raça?"
              value={breed}
              onChange={(e) => setBreed?.(e.target.value)}
              className={inputClasses}
            />
          )}
        </div>
      </div>
    );
  }

  if (step === 'profile') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Idade</label>
            <div className="flex gap-2">
              <Select value={age} onValueChange={(v) => setAge?.(v)}>
                <SelectTrigger className={`${inputClasses} flex-1`}>
                  <SelectValue placeholder="0" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/40 bg-white text-black max-h-[200px]">
                  {Array.from({ length: ageUnit === 'anos' ? 26 : 12 }, (_, i) => (
                    <SelectItem key={i} value={i.toString()}>{i}</SelectItem>
                  ))}
                </SelectContent>
              </Select>


              <Select value={ageUnit} onValueChange={(v) => setAgeUnit?.(v)}>
                <SelectTrigger className={`${inputClasses} w-24`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/40 bg-white text-black">

                  <SelectItem value="anos">Anos</SelectItem>
                  <SelectItem value="meses">Meses</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Sexo</label>
            <Select value={gender} onValueChange={(v) => setGender?.(v)}>
              <SelectTrigger className={inputClasses}>
                <SelectValue placeholder="Selecionar" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border/40 bg-white text-black">

                <SelectItem value="macho">Macho</SelectItem>
                <SelectItem value="femea">Fêmea</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Peso (kg)</label>
            <Input
              type="number"
              placeholder="Ex: 5.5"
              value={weight}
              onChange={(e) => setWeight?.(e.target.value)}
              className={inputClasses}
              step="0.1"
              min="0"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Temperamento</label>
            <Select value={temperament} onValueChange={(v) => setTemperament?.(v)}>
              <SelectTrigger className={inputClasses}>
                <SelectValue placeholder="Selecionar" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border/40 bg-white text-black">
                <SelectItem value="docil">Dócil</SelectItem>
                <SelectItem value="brincalhao">Brincalhão</SelectItem>
                <SelectItem value="calmo">Calmo</SelectItem>
                <SelectItem value="moderavel">Moderável</SelectItem>
                <SelectItem value="timido">Tímido</SelectItem>
                <SelectItem value="protetor">Protetor</SelectItem>
                <SelectItem value="agressivo">Agressivo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'health') {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <SectionLabel icon={Heart} label="Saúde" />
          <Textarea
            placeholder="Informações médicas (alergias, medicações...) - opcional"
            value={medicalInfo}
            onChange={(e) => setMedicalInfo?.(e.target.value)}
            className="rounded-2xl border-border/60 bg-white text-black px-4 py-3 text-sm min-h-[100px] resize-none shadow-sm focus:shadow-md focus:border-accent/50 transition-all duration-200"
          />
        </div>

        <div className="space-y-1.5">
          <SectionLabel icon={Shield} label="Emergência" />
          <Input
            type="text"
            placeholder="Nome e telefone de contato"
            value={emergencyContact}
            onChange={(e) => setEmergencyContact?.(e.target.value)}
            className={inputClasses}
          />
        </div>
      </div>
    );
  }

  return null;
};
