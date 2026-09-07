import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Chat conversacional do PetWalker Beta.
// Recebe { messages: [{role, content}], context: { petName, walkerName, walkType, plannedMinutes, elapsedMinutes, isReturning } }
// Responde { reply: string, request_return: boolean }
// O front-end mostra um botão "Autorizar retorno" quando request_return = true
// e o usuário, ao clicar, autoriza o início do retorno do passeio.

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-3-flash-preview';

interface IncomingMessage { role: 'user' | 'assistant'; content: string }
interface Context {
  petName?: string;
  walkerName?: string;
  walkType?: 'livre' | 'local';
  plannedMinutes?: number;
  elapsedMinutes?: number;
  isReturning?: boolean;
}

const buildSystemPrompt = (ctx: Context) => `Você é o PetWalker Beta, um passeador de cães profissional e simpático que está agora mesmo passeando com o pet ${ctx.petName || 'do cliente'}.
Contexto do passeio:
- Tipo: ${ctx.walkType === 'local' ? 'rota com paradas definidas pelo dono' : 'passeio livre'}
- Duração contratada: ${ctx.plannedMinutes ?? 30} min
- Tempo decorrido: ${ctx.elapsedMinutes ?? 0} min
- Já está no retorno: ${ctx.isReturning ? 'sim' : 'não'}

REGRAS:
1. Fale em português brasileiro, tom humano, breve (1-3 frases), nunca diga que é uma IA.
2. Trate o cliente com gentileza. Use o nome do pet quando fizer sentido.
3. Se o cliente pedir para o pet voltar / encerrar / retornar / "pode vir" / "trazer de volta", confirme uma única vez ("Posso retornar agora com ${ctx.petName || 'o pet'}?") e marque request_return=true.
4. Quando o cliente CONFIRMAR depois da sua pergunta (sim, pode, ok, confirma, autorizado, vamos), responda algo curto como "Combinado! Voltando agora 🐾" e mantenha request_return=true.
5. Se já está no retorno, NÃO peça retorno de novo — diga onde está, distância aproximada, e tempo até chegar.
6. Para qualquer outra pergunta (como está o pet, fotos, comportamento, água, xixi), responda de forma natural e tranquilizadora.

FORMATO DE SAÍDA: APENAS um objeto JSON válido, sem markdown, sem texto fora do JSON, com a forma:
{"reply": "<sua resposta em pt-BR>", "request_return": <true|false>}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY ausente' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const body = await req.json().catch(() => ({} as any));
    const messages: IncomingMessage[] = Array.isArray(body.messages) ? body.messages : [];
    const context: Context = typeof body.context === 'object' && body.context ? body.context : {};
    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiRes = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt(context) },
          ...messages.slice(-20).map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content || '').slice(0, 2000),
          })),
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    });

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ error: 'rate_limited', reply: 'Tô sem sinal por um instante, pode mandar de novo? 📶' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (aiRes.status === 402) {
      return new Response(JSON.stringify({ error: 'credits_exhausted', reply: 'Tive um problema técnico aqui, mas tá tudo bem com ' + (context.petName || 'o pet') + '! 🐾' }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!aiRes.ok) {
      const t = await aiRes.text();
      return new Response(JSON.stringify({ error: 'ai_error', detail: t.slice(0, 500), reply: 'Tive um problema técnico, tenta de novo?' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await aiRes.json();
    const raw = data?.choices?.[0]?.message?.content ?? '';
    let parsed: { reply?: string; request_return?: boolean } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Fallback: usa o texto cru como resposta
      parsed = { reply: String(raw).trim() || 'Tudo certo por aqui!', request_return: false };
    }
    const reply = (parsed.reply && String(parsed.reply).trim()) || 'Tudo certo por aqui!';
    const request_return = !!parsed.request_return;

    return new Response(JSON.stringify({ reply, request_return }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'unhandled', detail: String(e?.message || e), reply: 'Tive um problema, pode repetir?' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});