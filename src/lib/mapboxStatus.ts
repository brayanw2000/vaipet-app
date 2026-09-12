/**
 * Ciclo de vida explícito do mapa.
 *
 * - `loading`        → mapa criado, aguardando o evento `load`.
 * - `ready`          → estilo carregado; a rota pode usar o mapa.
 * - `missing-config` → `VITE_MAPBOX_TOKEN` ausente/inválido; o construtor
 *                      do Mapbox NUNCA é chamado.
 * - `error`          → construção, evento de erro ou timeout de carregamento.
 *
 * Compartilhado entre a tela `/search-walk` e o guard da rota para que um
 * único estado decida se o mapa está utilizável.
 */
export type MapStatus = 'loading' | 'ready' | 'missing-config' | 'error';

/** `true` quando o mapa não pode ser usado (fallback obrigatório). */
export const isMapUnavailable = (status: MapStatus | null): boolean =>
  status === 'missing-config' || status === 'error';
