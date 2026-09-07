import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const PRIMARY_COLOR = '#31D880';
const BG_COLOR = '#F2F2F7';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const emailWrapper = (content: string) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1C1C1E; background-color: white; border-radius: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="color: ${PRIMARY_COLOR}; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">VaiPet</h1>
    </div>
    
    ${content}
    
    <div style="margin-top: 48px; padding-top: 24px; border-top: 1px solid #E5E5EA; text-align: center;">
      <p style="font-size: 13px; color: #8E8E93; line-height: 1.4;">
        © 2026 VaiPet. Todos os direitos reservados.<br>
        O app feito com amor para o seu pet. 🐾<br>
        <a href="https://vaipet.app" style="color: ${PRIMARY_COLOR}; text-decoration: none; font-weight: 600;">vaipet.app</a>
      </p>
    </div>
  </div>
`;

interface SendEmailRequest {
  to: string | string[];
  subject: string;
  html: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    const { to, subject, html }: SendEmailRequest = await req.json();

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "VaiPet <noreply@vaipet.app>",
        to: Array.isArray(to) ? to : [to],
        subject,
        html: emailWrapper(html),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "Failed to send email");
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
