import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fail-closed cleanup rigoroso para ambientes E2E.
 * Garante que NENHUM dado de teste permaneça e que apenas dados E2E sejam tocados.
 */
export async function failClosedCleanup(supabase: SupabaseClient, userIds: string[], runId: string) {
  if (!runId) throw new Error(JSON.stringify({ error: 'runId_missing', context: 'failClosedCleanup' }));
  
  console.log(`[cleanup] Iniciando auditoria para runId: ${runId}`);

  // 1. Validar usuários antes de qualquer ação
  const verifiedIds: string[] = [];
  for (const id of userIds) {
    const { data: user, error } = await supabase.auth.admin.getUserById(id);
    if (error) {
      if (error.status === 404) continue;
      throw new Error(JSON.stringify({ error: 'user_fetch_failed', id, details: error }));
    }
    
    const metadata = user?.user?.user_metadata || {};
    const isE2E = metadata.e2e_test === true;
    const isRightRun = metadata.e2e_run_id === runId;
    
    if (isE2E && isRightRun) {
      verifiedIds.push(id);
    } else {
      throw new Error(JSON.stringify({ 
        error: 'security_violation', 
        message: 'Tentativa de deletar usuário não-E2E ou de outro run',
        id,
        metadata
      }));
    }
  }

  // 2. Buscar IDs de walk_sessions vinculados ao runId para cleanup fail-closed de tabelas filhas
  const { data: walkSessions, error: wsError } = await supabase
    .from('walk_sessions')
    .select('id')
    .eq('e2e_run_id', runId);

  if (wsError) {
    throw new Error(JSON.stringify({ error: 'walk_sessions_fetch_failed', details: wsError }));
  }
  
  if (walkSessions === null || walkSessions === undefined) {
    throw new Error(JSON.stringify({ error: 'walk_sessions_inconclusive', runId }));
  }
  
  const sessionIds = walkSessions.map(s => s.id);

  // 3. Ordem de deleção (Filhos -> Pais) usando colunas reais validadas
  const tableCleanup = [
    { name: 'walk_pickup_codes', col: 'session_id', values: sessionIds },
    { name: 'walker_tracking', col: 'walk_session_id', values: sessionIds },
    { name: 'walk_offers', col: 'session_id', values: sessionIds },
    { name: 'petwalker_earnings', col: 'walk_session_id', values: sessionIds },
    { name: 'walk_sessions', col: 'id', values: sessionIds },
    { name: 'pets', col: 'owner_id', values: verifiedIds },
    { name: 'petwalker_profiles', col: 'user_id', values: verifiedIds },
    { name: 'user_roles', col: 'user_id', values: verifiedIds },
    { name: 'profiles', col: 'id', values: verifiedIds }
  ];

  for (const task of tableCleanup) {
    if (task.values.length === 0) continue;

    const { error: delErr } = await supabase
      .from(task.name)
      .delete()
      .in(task.col, task.values);

    if (delErr) {
      // Se houver qualquer erro (incluindo 42703), abortar conforme instrução
      throw new Error(JSON.stringify({ error: 'table_delete_failed', table: task.name, details: delErr }));
    }

    // Verificação de Resíduos usando filtro real de cada tabela
    const { count, error: countErr } = await supabase
      .from(task.name)
      .select('*', { count: 'exact', head: true })
      .in(task.col, task.values);
        
    if (countErr) {
      throw new Error(JSON.stringify({ error: 'residue_count_failed', table: task.name, details: countErr }));
    }
    
    if (count === null || count === undefined || count > 0) {
      throw new Error(JSON.stringify({ error: 'residue_detected', table: task.name, count }));
    }
  }

  // 4. Deleção de usuários no Auth e verificação 404
  for (const uid of verifiedIds) {
    const { error: authDelError } = await supabase.auth.admin.deleteUser(uid);
    if (authDelError && authDelError.status !== 404) {
      throw new Error(JSON.stringify({ error: 'auth_user_delete_failed', uid, details: authDelError }));
    }
    
    // Verificação determinística 404
    const { data: check, error: checkErr } = await supabase.auth.admin.getUserById(uid);
    if (check?.user) {
      throw new Error(JSON.stringify({ error: 'auth_ghost_user_persisted', uid }));
    }
    if (!checkErr || checkErr.status !== 404) {
      throw new Error(JSON.stringify({ error: 'auth_user_cleanup_inconclusive', uid, details: checkErr }));
    }
  }

  console.log(`[cleanup] Sucesso total para runId: ${runId}. Zero resíduos.`);
}
