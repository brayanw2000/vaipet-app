import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { taskId, breed } = await req.json()
    const MESHY_API_KEY = Deno.env.get('MESHY_API_KEY')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!MESHY_API_KEY) throw new Error('MESHY_API_KEY not set')

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

    // 1. Verificar status na Meshy
    const response = await fetch(`https://api.meshy.ai/v1/image-to-3d/${taskId}`, {
      headers: { 'Authorization': `Bearer ${MESHY_API_KEY}` }
    })

    const task = await response.json()
    console.log(`Polling task ${taskId}: status ${task.status}`)

    if (task.status === 'SUCCEEDED') {
      const glbUrl = task.model_urls?.glb

      if (glbUrl) {
        // Salvar no banco
        const { error } = await supabase
          .from('pet_models_3d')
          .upsert({ breed: breed.toLowerCase().trim(), glb_url: glbUrl }, { onConflict: 'breed' })

        if (error) throw error

        return new Response(
          JSON.stringify({ status: 'SUCCEEDED', glbUrl }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    return new Response(
      JSON.stringify({ status: task.status }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
