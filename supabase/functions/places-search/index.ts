import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_maps';
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      return new Response(JSON.stringify({ error: 'Google Maps connector not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const body = await req.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lng = typeof body.lng === 'number' ? body.lng : null;
    const radiusMeters = typeof body.radius === 'number' ? Math.min(50000, body.radius) : 20000;
    if (query.length < 2) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const reqBody: Record<string, unknown> = {
      textQuery: query,
      languageCode: 'pt-BR',
      regionCode: 'BR',
      maxResultCount: 8,
    };
    if (lat !== null && lng !== null) {
      reqBody.locationBias = {
        circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters },
      };
    }
    const res = await fetch(`${GATEWAY_URL}/places/v1/places:searchText`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': GOOGLE_MAPS_API_KEY,
        'Content-Type': 'application/json',
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.shortFormattedAddress',
      },
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) {
      const txt = await res.text();
      return new Response(JSON.stringify({ error: 'gateway_error', status: res.status, detail: txt }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const json = await res.json();
    const results = (json.places || []).map((p: any) => ({
      id: p.id,
      name: p.displayName?.text || '',
      address: p.formattedAddress || p.shortFormattedAddress || '',
      lat: p.location?.latitude,
      lng: p.location?.longitude,
    })).filter((r: any) => typeof r.lat === 'number' && typeof r.lng === 'number');
    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});