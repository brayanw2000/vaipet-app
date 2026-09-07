import React, { useState, useEffect } from 'react';
import { FileText, Download, Trash2, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Document {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
  notes?: string;
}

interface DocumentListProps {
  petId: string;
  documentType: 'vaccination_card' | 'medical_document';
  onDocumentDeleted?: () => void;
}

export const DocumentList: React.FC<DocumentListProps> = ({ 
  petId, 
  documentType, 
  onDocumentDeleted 
}) => {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDocuments();
  }, [petId, documentType]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('pet_documents')
        .select('*')
        .eq('pet_id', petId)
        .eq('document_type', documentType)
        .order('uploaded_at', { ascending: false });

      if (error) {
        console.error('Erro ao buscar documentos:', error);
        return;
      }

      setDocuments(data || []);
    } catch (error) {
      console.error('Erro:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleView = async (document: Document) => {
    try {
      const { data, error } = await supabase.storage
        .from('pet-documents')
        .createSignedUrl(document.file_path, 3600); // URL válida por 1 hora

      if (error) {
        console.error('Erro ao gerar URL:', error);
        toast.error('Erro ao abrir documento');
        return;
      }

      window.open(data.signedUrl, '_blank');
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao abrir documento');
    }
  };

  const handleDelete = async (document: Document) => {
    if (!confirm(`Tem certeza que deseja excluir "${document.file_name}"?`)) {
      return;
    }

    try {
      // Deletar arquivo do storage
      const { error: storageError } = await supabase.storage
        .from('pet-documents')
        .remove([document.file_path]);

      if (storageError) {
        console.error('Erro ao deletar arquivo:', storageError);
        toast.error('Erro ao deletar arquivo');
        return;
      }

      // Deletar registro do banco
      const { error: dbError } = await supabase
        .from('pet_documents')
        .delete()
        .eq('id', document.id);

      if (dbError) {
        console.error('Erro ao deletar registro:', dbError);
        toast.error('Erro ao deletar documento');
        return;
      }

      toast.success('Documento excluído com sucesso!');
      fetchDocuments(); // Recarregar lista
      onDocumentDeleted?.();
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao excluir documento');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-12 bg-gray-200 rounded"></div>
        <div className="h-12 bg-gray-200 rounded"></div>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-4">
        Nenhum documento encontrado
      </p>
    );
  }

  return (
    <div className="space-y-3 mt-3">
      {documents.map((document) => (
        <div 
          key={document.id} 
          className="bg-white border border-gray-200 rounded-xl p-3 flex items-center justify-between"
        >
          <div className="flex items-center gap-3 flex-1">
            <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
              <FileText className="w-4 h-4 text-gray-600" />
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 text-sm truncate">
                {document.file_name}
              </p>
              <p className="text-xs text-gray-500">
                {formatFileSize(document.file_size)} • {formatDate(document.uploaded_at)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleView(document)}
              className="h-8 w-8 p-0 hover:bg-blue-50"
            >
              <Eye className="w-4 h-4 text-blue-600" />
            </Button>
            
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleDelete(document)}
              className="h-8 w-8 p-0 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4 text-red-600" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};