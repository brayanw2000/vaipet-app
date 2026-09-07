import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { breed } = await req.json();
    if (!breed) {
      return new Response(JSON.stringify({ error: "Breed is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check if breed photo already exists
    const { data: existing } = await supabase
      .from("breed_photos")
      .select("photo_url")
      .eq("breed", breed.toLowerCase().trim())
      .maybeSingle();

    if (existing?.photo_url) {
      return new Response(JSON.stringify({ photo_url: existing.photo_url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate image with Lovable AI (Gemini image model)
    console.log(`Generating breed photo for: ${breed}`);
    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [
            {
              role: "user",
              content: `Generate a beautiful, professional photo of a ${breed} dog sitting calmly, facing the camera. Pure white background. Full body visible. Studio lighting. High quality pet photography style. The dog should look friendly and well-groomed. No text or watermarks.`,
            },
          ],
          modalities: ["image", "text"],
        }),
      }
    );

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const imageUrl = aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageUrl) {
      console.error("No image in AI response:", JSON.stringify(aiData).slice(0, 500));
      throw new Error("No image generated");
    }

    // Extract base64 data and upload to storage
    const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) throw new Error("Invalid image format from AI");

    const ext = base64Match[1];
    const base64Data = base64Match[2];
    const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

    const breedSlug = breed.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const filePath = `breeds/${breedSlug}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("pet-photos")
      .upload(filePath, binaryData, {
        contentType: `image/${ext}`,
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage
      .from("pet-photos")
      .getPublicUrl(filePath);

    const photoUrl = publicUrlData.publicUrl;

    // Cache in breed_photos table
    await supabase.from("breed_photos").upsert({
      breed: breed.toLowerCase().trim(),
      photo_url: photoUrl,
    }, { onConflict: "breed" });

    console.log(`Breed photo generated and cached: ${breedSlug} -> ${photoUrl}`);

    return new Response(JSON.stringify({ photo_url: photoUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-breed-photo error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
