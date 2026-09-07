import { Database } from "@/integrations/supabase/types";

export type WalkStatus = Database['public']['Enums']['walk_status'];

export const WALK_STATUS_LABELS: Record<WalkStatus, string> = {
  searching: 'Buscando PetWalker',
  offered: 'Proposta Enviada',
  accepted: 'Aceito',
  heading_to_pickup: 'Em Deslocamento',
  arrived: 'No Local',
  in_progress: 'Em Andamento',
  returning: 'Retornando',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  expired: 'Expirado',
  scheduled: 'Agendado'
};
