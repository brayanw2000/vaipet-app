/**
 * Configuração do Mapbox para o frontend.
 *
 * Regras (segurança + resiliência):
 * - Lê exclusivamente `import.meta.env.VITE_MAPBOX_TOKEN`;
 * - Nunca registra o valor do token em logs;
 * - Nunca usa chave de outro provedor (Google Maps) como fallback;
 * - Nunca há token padrão embutido no código.
 *
 * O valor bruto pode vir de um `.env` incompleto — inclusive a string literal
 * `"undefined"` quando a variável não foi substituída — então normalizamos
 * antes de considerar que existe um token utilizável.
 */

export const MAPBOX_TOKEN_ENV_VAR = 'VITE_MAPBOX_TOKEN';

/**
 * Normaliza um valor vindo do ambiente.
 * Retorna `null` para ausente, vazio, só espaços ou o texto literal
 * `"undefined"` (caso comum de `.env` sem valor substituído).
 */
export function normalizeMapboxToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'undefined') return null;
  return trimmed;
}

/** Token público do Mapbox, ou `null` quando não configurado. Nunca logar. */
export const mapboxToken: string | null = normalizeMapboxToken(
  import.meta.env.VITE_MAPBOX_TOKEN,
);

/** Booleano seguro para logs/telemetria (não expõe o valor). */
export const hasMapboxToken: boolean = mapboxToken !== null;

/** Textos reaproveitados pelos fallbacks de mapa (Home e SearchWalk). */
export const MAP_UNAVAILABLE_TITLE = 'Mapa indisponível no momento';
export const MAP_UNAVAILABLE_MESSAGE =
  'Não foi possível carregar o mapa. Tente novamente em instantes.';
export const MAP_UNAVAILABLE_SHORT = 'Mapa temporariamente indisponível';
