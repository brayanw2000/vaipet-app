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
    const { breed, imageUrl } = await req.json()
    const MESHY_API_KEY = Deno.env.get('MESHY_API_KEY')

    if (!MESHY_API_KEY) {
      throw new Error('MESHY_API_KEY not set')
    }

    console.log(`Generating 3D model for breed: ${breed} with image: ${imageUrl}`)

    // 1. Iniciar tarefa Image-to-3D na Meshy
    const response = await fetch('https://api.meshy.ai/v1/image-to-3d', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MESHY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        enable_pbr: true,
      }),
    })

    const task = await response.json()
    if (!task.result) {
      throw new Error(`Failed to create Meshy task: ${JSON.stringify(task)}`)
    }

    const taskId = task.result

    // Em uma implementação real, usaríamos um webhook ou polling.
    // Para simplificar este exemplo inicial, retornamos o taskId.
    // O frontend ou outra função monitorará o progresso.

    return new Response(
      JSON.stringify({ taskId, message: "Task created successfully" }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
