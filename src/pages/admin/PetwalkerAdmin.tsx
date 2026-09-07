
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Search, 
  Filter, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  ChevronRight,
  RefreshCcw,
  User,
  MapPin,
  Calendar,
  Phone,
  AlertCircle,
  FileText
} from 'lucide-react';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type Application = {
  id: string;
  legal_name: string;
  city: string;
  status: string;
  document_status: string;
  submitted_at: string;
  reviewed_at: string | null;
};

type ApplicationDetails = Application & {
  birth_date: string;
  phone: string;
  experience_description: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  rejection_reason: string | null;
};

const PetwalkerAdmin = () => {
  const navigate = useNavigate();
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;

  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [details, setDetails] = useState<ApplicationDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [processingAction, setProcessingAction] = useState(false);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);

  const fetchApplications = useCallback(async (status: string, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const { data, error } = await supabase.rpc('get_petwalker_applications_admin', {
        _status: status
      });

      if (error) throw error;
      setApplications(data || []);
    } catch (err) {
      console.error('Error fetching applications:', err);
      toast.error('Erro ao carregar candidaturas');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_admin_application_stats');
      if (error) throw error;
      if (data && (data as any[]).length > 0) {
        const statsRow = (data as any[])[0];
        setStats({
          pending: Number(statsRow.pending_count || 0),
          approved: Number(statsRow.approved_count || 0),
          rejected: Number(statsRow.rejected_count || 0)
        });
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchApplications(activeTab);
    fetchStats();
  }, [activeTab, fetchApplications, fetchStats]);

  const handleViewDetails = async (appId: string) => {
    setSelectedAppId(appId);
    setDetailsLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_petwalker_application_admin', {
        _application_id: appId
      });
      if (error) throw error;
      if (data && data.length > 0) {
        setDetails(data[0] as ApplicationDetails);
      }
    } catch (err) {
      console.error('Error fetching details:', err);
      toast.error('Erro ao carregar detalhes');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!details || processingAction) return;
    setShowApproveConfirm(false);
    setProcessingAction(true);
    try {
      const { error } = await supabase.rpc('approve_petwalker_application', {
        application_id: details.id
      });
      if (error) throw error;
      toast.success('Candidatura aprovada com sucesso!');
      setSelectedAppId(null);
      setDetails(null);
      fetchApplications(activeTab);
      fetchStats();
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Error approving:', error);
      toast.error(error.message || 'Erro ao aprovar candidatura');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleReject = async () => {
    if (!details || processingAction || rejectionReason.length < 10) {
        if (rejectionReason.length < 10) toast.error('Motivo muito curto (mínimo 10 caracteres)');
        return;
    }
    setProcessingAction(true);
    try {
      const { error } = await supabase.rpc('reject_petwalker_application', {
        _application_id: details.id,
        _reason: rejectionReason
      });
      if (error) throw error;
      toast.success('Candidatura rejeitada');
      setShowRejectDialog(false);
      setRejectionReason('');
      setSelectedAppId(null);
      setDetails(null);
      fetchApplications(activeTab);
      fetchStats();
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Error rejecting:', error);
      toast.error(error.message || 'Erro ao rejeitar candidatura');
    } finally {
      setProcessingAction(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  return (
    <div 
      className="min-h-screen flex flex-col max-w-md mx-auto"
      style={{ background: PAPER, color: INK, fontFamily: 'DM Sans, sans-serif' }}
    >
      {/* Header */}
      <div className="px-5 pt-8 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/admin')}
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{ border: `1px solid ${INK}26` }}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Candidaturas
          </h1>
        </div>
        <button
          onClick={() => fetchApplications(activeTab, true)}
          className={`w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform ${refreshing ? 'animate-spin' : ''}`}
          style={{ border: `1px solid ${INK}26` }}
        >
          <RefreshCcw className="w-4 h-4 opacity-60" />
        </button>
      </div>

      {/* Stats Quick View (Mock or Real if you want) */}
      <div className="px-5 py-4 flex gap-2 overflow-x-auto no-scrollbar">
        {(['pending', 'approved', 'rejected'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-5 py-2.5 rounded-2xl text-sm font-bold whitespace-nowrap transition-all border"
            style={{ 
              background: activeTab === tab ? INK : 'transparent',
              color: activeTab === tab ? PAPER : INK,
              borderColor: activeTab === tab ? INK : `${INK}26`,
              fontFamily: 'Space Grotesk, sans-serif'
            }}
          >
            {tab === 'pending' ? `Pendentes (${stats.pending})` : tab === 'approved' ? `Aprovadas (${stats.approved})` : `Rejeitadas (${stats.rejected})`}
          </button>
        ))}
      </div>

      {/* List Content */}
      <div className="flex-1 px-5 pt-2 pb-10">
        {loading ? (
          <div className="py-20 text-center space-y-4">
            <RefreshCcw className="w-8 h-8 animate-spin mx-auto opacity-20" />
            <p className="text-sm opacity-40">Buscando candidaturas...</p>
          </div>
        ) : applications.length === 0 ? (
          <div className="py-20 text-center space-y-4 opacity-40">
            <div className="w-16 h-16 bg-current/10 rounded-full flex items-center justify-center mx-auto">
              <Clock className="w-8 h-8" />
            </div>
            <p className="font-bold tracking-tight">Nenhuma candidatura encontrada</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {applications.map((app) => (
              <button
                key={app.id}
                onClick={() => handleViewDetails(app.id)}
                className="w-full p-4 flex items-center justify-between rounded-[24px] text-left transition-all active:scale-[0.98]"
                style={{ background: PAPER, border: `1px solid ${INK}14` }}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-black/5 shrink-0">
                    <User className="w-6 h-6 opacity-40" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-base truncate" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                      {app.legal_name}
                    </h3>
                    <div className="flex items-center gap-2 text-[11px] opacity-60">
                      <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" /> {app.city}</span>
                      <span>•</span>
                      <span>{formatDate(app.submitted_at)}</span>
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 opacity-20 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Details Sheet/Modal */}
      <Dialog open={!!selectedAppId} onOpenChange={(open) => !open && setSelectedAppId(null)}>
        <DialogContent className="max-w-[90vw] sm:max-w-md rounded-[32px] border-none p-0 overflow-hidden" style={{ background: PAPER, color: INK }}>
          {detailsLoading ? (
            <div className="p-20 text-center space-y-4">
              <RefreshCcw className="w-8 h-8 animate-spin mx-auto opacity-20" />
            </div>
          ) : details ? (
            <div className="max-h-[80vh] overflow-y-auto no-scrollbar">
              <div className="p-6 pb-20 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="w-14 h-14 bg-black/5 rounded-[22px] flex items-center justify-center">
                    <User className="w-7 h-7 opacity-40" />
                  </div>
                  <div 
                    className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                    style={{ 
                      background: details.status === 'approved' ? '#31D88020' : details.status === 'rejected' ? '#E5484D20' : `${INK}10`,
                      color: details.status === 'approved' ? '#31D880' : details.status === 'rejected' ? '#E5484D' : INK
                    }}
                  >
                    {details.status}
                  </div>
                </div>

                <div className="space-y-1">
                  <h2 className="text-2xl font-bold leading-tight" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                    {details.legal_name}
                  </h2>
                  <p className="text-sm opacity-60 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Nascido em {details.birth_date}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                   <div className="p-3.5 rounded-2xl bg-black/5 space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Telefone</p>
                      <p className="text-sm font-medium flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {details.phone}</p>
                   </div>
                   <div className="p-3.5 rounded-2xl bg-black/5 space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Cidade</p>
                      <p className="text-sm font-medium flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {details.city}</p>
                   </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-widest opacity-40">Experiência</h4>
                  <div className="p-4 rounded-2xl bg-black/5 text-sm leading-relaxed italic opacity-80">
                    "{details.experience_description}"
                  </div>
                </div>

                <div className="p-4 rounded-2xl space-y-3" style={{ border: `1px solid ${INK}14` }}>
                  <h4 className="text-xs font-bold uppercase tracking-widest opacity-40 flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" /> Contato de Emergência</h4>
                  <div className="text-sm space-y-1">
                    <p className="font-bold">{details.emergency_contact_name}</p>
                    <p className="opacity-60">{details.emergency_contact_phone}</p>
                  </div>
                </div>

                {details.status === 'rejected' && details.rejection_reason && (
                  <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-red-500/60">Motivo da Rejeição</h4>
                    <p className="text-sm text-red-500/80">{details.rejection_reason}</p>
                  </div>
                )}

                {details.status === 'pending' && (
                  <div className="grid grid-cols-2 gap-3 pt-4">
                    <Button 
                      variant="outline" 
                      onClick={() => setShowRejectDialog(true)}
                      className="h-14 rounded-2xl font-bold border-red-500/20 text-red-500 hover:bg-red-500/5"
                    >
                      <XCircle className="w-5 h-5 mr-2" /> Rejeitar
                    </Button>
                    <Button 
                      onClick={() => setShowApproveConfirm(true)}
                      disabled={processingAction}
                      className="h-14 rounded-2xl font-bold"
                      style={{ background: '#31D880', color: '#0B1410' }}
                    >
                      {processingAction ? <RefreshCcw className="w-5 h-5 animate-spin" /> : <><CheckCircle2 className="w-5 h-5 mr-2" /> Aprovar</>}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Reject Reason Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="max-w-[85vw] sm:max-w-sm rounded-[32px] p-6" style={{ background: PAPER, color: INK }}>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Por que rejeitar?</DialogTitle>
            <DialogDescription>O candidato receberá este feedback.</DialogDescription>
          </DialogHeader>
          <Textarea 
            placeholder="Ex: Documentação ilegível ou informações incompletas..."
            className="mt-4 rounded-2xl min-h-[120px] bg-black/5 border-none resize-none p-4"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
          />
          <DialogFooter className="mt-6">
            <Button 
              onClick={handleReject}
              disabled={processingAction || rejectionReason.length < 10}
              className="w-full h-14 rounded-2xl font-bold bg-red-500 text-white hover:bg-red-600"
            >
              {processingAction ? <RefreshCcw className="w-5 h-5 animate-spin" /> : 'Confirmar Rejeição'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Approve Confirmation Dialog */}
      <Dialog open={showApproveConfirm} onOpenChange={setShowApproveConfirm}>
        <DialogContent className="max-w-[85vw] sm:max-w-sm rounded-[32px] p-6" style={{ background: PAPER, color: INK }}>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Aprovar Candidato?</DialogTitle>
            <DialogDescription>
              Deseja realmente aprovar a candidatura de <strong>{details?.legal_name}</strong>?
            </DialogDescription>
          </DialogHeader>
          <div className="mt-6 flex flex-col gap-3">
            <Button 
              onClick={handleApprove}
              disabled={processingAction}
              className="w-full h-14 rounded-2xl font-bold bg-[#31D880] text-[#0B1410] hover:bg-[#2bbd70]"
            >
              {processingAction ? <RefreshCcw className="w-5 h-5 animate-spin" /> : 'Confirmar Aprovação'}
            </Button>
            <Button 
              variant="ghost"
              onClick={() => setShowApproveConfirm(false)}
              className="w-full h-12 rounded-2xl font-bold opacity-60"
            >
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PetwalkerAdmin;
