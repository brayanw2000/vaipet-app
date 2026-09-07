import React, { useEffect, useRef, useState } from 'react';
import { Send, X, Headphones, ShieldCheck } from 'lucide-react';

interface SupportChatProps {
  open: boolean;
  onClose: () => void;
  isDarkMode?: boolean;
}

type Msg = { id: string; role: 'user' | 'support'; content: string; ts: number };
const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Lightweight live-support chat sheet. Mirrors the PetwalkerChat look but
 * talks to the VaiPet support team. Replies are simulated so the surface
 * works end-to-end before the live agent backend is wired up.
 */
export const SupportChat: React.FC<SupportChatProps> = ({ open, onClose, isDarkMode = false }) => {
  const [messages, setMessages] = useState<Msg[]>(() => [{
    id: uid(), role: 'support', ts: Date.now(),
    content: 'Olá! Aqui é o Suporte VaiPet 👋 Estamos online e prontos para ajudar. Como podemos te ajudar com o seu passeio?',
  }]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }));
  }, [messages, open, typing]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 150); }, [open]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setMessages(m => [...m, { id: uid(), role: 'user', content: text, ts: Date.now() }]);
    setInput('');
    setTyping(true);
    setTimeout(() => {
      setMessages(m => [...m, {
        id: uid(), role: 'support', ts: Date.now(),
        content: 'Recebido! Um atendente humano irá te responder em instantes. Enquanto isso, fique tranquilo — o passeio segue monitorado em tempo real. 💚',
      }]);
      setTyping(false);
    }, 1100);
  };

  if (!open) return null;

  const surface = isDarkMode ? '#0a0d0c' : '#ffffff';
  const ink = isDarkMode ? '#f5f7f6' : '#0a1a14';
  const muted = isDarkMode ? 'rgba(245,247,246,0.55)' : 'rgba(10,26,20,0.55)';
  const hairline = isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(10,26,20,0.06)';
  const userBg = '#31D880';
  const supportBg = isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(10,26,20,0.04)';

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="w-full sm:max-w-md h-[85vh] sm:h-[78vh] sm:rounded-3xl rounded-t-3xl flex flex-col overflow-hidden animate-slide-up"
        style={{ background: surface, border: `1px solid ${hairline}` }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: `1px solid ${hairline}` }}>
          <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#31D880,#31d880)' }}>
            <Headphones className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold leading-tight" style={{ color: ink }}>Suporte VaiPet</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[11px] font-semibold" style={{ color: muted }}>Online · Chat ao vivo</span>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform" style={{ background: supportBg }}>
            <X className="w-4 h-4" style={{ color: ink }} />
          </button>
        </div>

        {/* Trust banner */}
        <div className="px-5 py-2 flex items-center gap-2" style={{ background: isDarkMode ? 'rgba(0,169,120,0.08)' : 'rgba(0,169,120,0.06)' }}>
          <ShieldCheck className="w-3.5 h-3.5" style={{ color: '#31D880' }} />
          <p className="text-[10.5px] font-semibold" style={{ color: muted }}>Conversa criptografada · tempo médio de resposta &lt; 2 min</p>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[78%] px-3.5 py-2.5 rounded-2xl text-[13.5px] leading-relaxed"
                style={{
                  background: m.role === 'user' ? userBg : supportBg,
                  color: m.role === 'user' ? '#ffffff' : ink,
                  borderBottomRightRadius: m.role === 'user' ? 6 : 16,
                  borderBottomLeftRadius: m.role === 'support' ? 6 : 16,
                }}
              >
                {m.content}
              </div>
            </div>
          ))}
          {typing && (
            <div className="flex justify-start">
              <div className="px-3.5 py-2.5 rounded-2xl flex items-center gap-1" style={{ background: supportBg, borderBottomLeftRadius: 6 }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: muted }} />
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: muted, animationDelay: '0.15s' }} />
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: muted, animationDelay: '0.3s' }} />
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="px-3 py-3 flex items-end gap-2" style={{ borderTop: `1px solid ${hairline}` }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="Escreva sua mensagem…"
            className="flex-1 resize-none rounded-2xl px-4 py-3 text-sm outline-none max-h-32"
            style={{ background: supportBg, color: ink, border: `1px solid ${hairline}` }}
          />
          <button
            onClick={send}
            disabled={!input.trim()}
            className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 active:scale-95 transition-all disabled:opacity-40"
            style={{ background: '#31D880' }}
            aria-label="Enviar"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};
