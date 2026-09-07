import React, { useState, useRef } from 'react';
import { Upload, FileText, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface DocumentUploadProps {
  petId: string;
  documentType: 'vaccination_card' | 'medical_document';
  onUploadComplete?: () => void;
}

export const DocumentUpload: React.FC<DocumentUploadProps> = ({ 
  petId, 
  documentType, 
  onUploadComplete 
}) => {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = async (files: FileList) => {
    const file = files[0];
    if (!file || !user) return;

    // Validar tipo de arquivo
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Tipo de arquivo não suportado. Use PDF, JPG ou PNG.');
      return;
    }

    // Validar tamanho (10MB)
    if (file.size > 10485760) {
      toast.error('Arquivo muito grande. Máximo 10MB.');
      return;
    }

    setUploading(true);

    try {
      // Upload para storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/pets/${petId}/documents/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('pet-documents')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      // Salvar registro na tabela
      const { error: dbError } = await supabase
        .from('pet_documents')
        .insert({
          pet_id: petId,
          document_type: documentType,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: user.id
        });

      if (dbError) {
        throw dbError;
      }

      toast.success('Documento enviado com sucesso!');
      onUploadComplete?.();
      
    } catch (error) {
      console.error('Erro no upload:', error);
      toast.error('Erro ao enviar documento. Tente novamente.');
    } finally {
      setUploading(false);
    }
  };

  const onButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      className={`relative border-2 border-dashed rounded-2xl p-6 text-center transition-colors ${
        dragActive 
          ? 'border-[#31D880] bg-[#31D880]/5' 
          : 'border-gray-300 hover:border-[#31D880] hover:bg-gray-50'
      } ${uploading ? 'opacity-50' : ''}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={handleChange}
        disabled={uploading}
      />
      
      <div className="flex flex-col items-center space-y-3">
        <div className="w-12 h-12 bg-[#31D880]/10 rounded-full flex items-center justify-center">
          {uploading ? (
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#31D880]" />
          ) : (
            <Upload className="w-6 h-6 text-[#31D880]" />
          )}
        </div>
        
        <div>
          <p className="text-sm font-medium text-gray-900 mb-1">
            {uploading ? 'Enviando...' : 'Clique ou arraste o arquivo'}
          </p>
          <p className="text-xs text-gray-500">
            PDF, JPG ou PNG (máx. 10MB)
          </p>
        </div>
        
        <Button
          onClick={onButtonClick}
          disabled={uploading}
          variant="outline"
          size="sm"
          className="border-[#31D880] text-[#31D880] hover:bg-[#31D880]/10"
        >
          <FileText className="w-4 h-4 mr-2" />
          Selecionar Arquivo
        </Button>
      </div>
    </div>
  );
};