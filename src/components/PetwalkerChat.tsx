import React, { useEffect, useRef, useState } from 'react';
import { Send, X, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export interface PetwalkerChatProps {
  open: boolean;
  onClose: () => void;
  onAuthorizeReturn: () => void;
  petName: string;
  walkerName: string;
  walkerAvatar?: string;
  walkType?: 'livre' | 'local';
  plannedMinutes: number;
  elapsedMinutes: number;
  isReturning: boolean;
}

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  // Quando true, mostra o card "Autorizar retorno" sob esta mensagem.
  showReturnCta?: boolean;
  // Marca que esta solicitação já foi autorizada (oculta o CTA).
  authorized?: boolean;
};

const uid = () => Math.random().toString(36).slice(2, 10);

export const PetwalkerChat: React.FC<PetwalkerChatProps> = ({
  open, onClose, onAuthorizeReturn,
  petName, walkerName, walkerAvatar, walkType, plannedMinutes, elapsedMinutes, isReturning,
}) => {
  const [messages, setMessages] = useState<Msg[]>(() => [{
    id: uid(),
    role: 'assistant',
    content: `Oi! Aqui é o ${walkerName}, tô passeando com ${petName} agora. Tudo certo por aqui 🐾 — qualquer coisa é só chamar.`,
  }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll ao fim sempre que chega mensagem nova / o painel abre.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [messages, open, sending]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 150); }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const userMsg: Msg = { id: uid(), role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('petwalker-chat', {
        body: {
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          context: {
            petName, walkerName, walkType,
            plannedMinutes, elapsedMinutes, isReturning,
          },
        },
      });
      if (error) throw error;
      const reply: string = (data?.reply as string) || 'Tudo certo por aqui!';
      const requestReturn: boolean = !isReturning && !!data?.request_return;
      setMessages((prev) => [...prev, {
        id: uid(), role: 'assistant', content: reply, showReturnCta: requestReturn,
      }]);
    } catch (e) {
      setMessages((prev) => [...prev, {
        id: uid(), role: 'assistant',
        content: 'Tive um problema técnico aqui, pode tentar de novo? 📶',
      }]);
    } finally {
      setSending(false);
    }
  };

  const authorize = (id: string) => {
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, authorized: true, showReturnCta: false } : m));
    setMessages((prev) => [...prev, {
      id: uid(), role: 'assistant',
      content: `Combinado! Tô voltando agora com ${petName} 🏠`,
    }]);
    onAuthorizeReturn();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md h-[88vh] sm:h-[640px] rounded-t-[28px] sm:rounded-[28px] flex flex-col overflow-hidden animate-scale-in"
        style={{
          background: 'linear-gradient(180deg, #111315 0%, #0a0b0d 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/5">
          <div className="relative">
            <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10">
              {walkerAvatar
                ? <img src={walkerAvatar} alt={walkerName} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center bg-[#31D880] text-white font-extrabold">{walkerName.charAt(0)}</div>}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#22C55E] border-2 border-[#111315]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-extrabold text-[15px] leading-tight truncate">{walkerName}</p>
            <p className="text-[11px] text-white/55 font-semibold leading-tight">
              {isReturning ? `Retornando com ${petName}` : `Passeando com ${petName} • online`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center active:scale-95 transition"
            aria-label="Fechar chat"
          >
            <X className="w-4 h-4 text-white/80" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[82%] flex flex-col gap-2">
                <div
                  className={`px-3.5 py-2.5 rounded-2xl text-[14px] leading-snug whitespace-pre-wrap break-words ${
                    m.role === 'user'
                      ? 'bg-[#31D880] text-[#0B1410] rounded-br-md'
                      : 'bg-white/[0.07] text-white/95 rounded-bl-md border border-white/5'
                  }`}
                >
                  {m.content}
                </div>
                {m.showReturnCta && !m.authorized && (
                  <div className="rounded-2xl border border-[#31D880]/40 bg-[#31D880]/10 p-3 animate-fade-in">
                    <p className="text-[12px] font-semibold text-white/85 mb-2">
                      Confirmar o retorno agora?
                    </p>
                    <button
                      onClick={() => authorize(m.id)}
                      className="w-full py-2.5 rounded-xl text-white text-[13px] font-extrabold flex items-center justify-center gap-1.5 active:scale-[0.98] transition"
                      style={{ background: '#31D880', boxShadow: '0 8px 20px rgba(49,216,128,0.35)' }}
                    >
                      <ShieldCheck className="w-4 h-4" /> Autorizar retorno
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-white/[0.07] border border-white/5 text-white/70 text-[13px] flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> digitando…
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="px-3 py-3 border-t border-white/5 bg-black/30">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder={`Mensagem para ${walkerName}…`}
              className="flex-1 resize-none bg-white/[0.06] text-white placeholder:text-white/35 text-[14px] rounded-2xl px-4 py-2.5 outline-none border border-white/5 focus:border-white/15 transition"
              style={{ maxHeight: 120 }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center active:scale-95 transition disabled:opacity-40"
              style={{ background: '#31D880', boxShadow: '0 8px 20px rgba(49,216,128,0.35)' }}
              aria-label="Enviar"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};