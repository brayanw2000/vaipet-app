import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, RefreshCw } from 'lucide-react';
import {
  hasMapboxToken,
  MAP_UNAVAILABLE_MESSAGE,
  MAP_UNAVAILABLE_TITLE,
} from '@/lib/mapboxConfig';
import { isMapUnavailable, type MapStatus } from '@/lib/mapboxStatus';
import { useHomeTheme } from '@/hooks/useHomeTheme';

/**
 * Guard do mapa para a rota `/search-walk`.
 *
 * Motivo: o Mapbox GL lança no construtor quando não há token válido (e o
 * estilo pode nunca carregar). Sem tratamento, o erro sobe pela árvore React
 * e a rota fica completamente branca — o usuário perde o acesso à tela.
 *
 * Este guard garante que:
 *  - sem `VITE_MAPBOX_TOKEN` a tela nem monta (o construtor nunca é chamado);
 *  - qualquer exceção da tela vira um fallback profissional, não tela branca;
 *  - quando a tela reporta `error` (construtor, evento do Mapbox ou timeout),
 *    o fallback substitui o conteúdo e bloqueia iniciar um passeio sem mapa.
 */

type ReportMapStatus = (status: MapStatus) => void;

const MapStatusContext = createContext<ReportMapStatus | null>(null);

/**
 * Publica o estado do mapa para o guard da rota.
 * Fora do guard (ex.: testes que renderizam a tela direto) é um no-op.
 */
export const useReportMapStatus = (status: MapStatus): void => {
  const report = useContext(MapStatusContext);
  useEffect(() => {
    report?.(status);
  }, [report, status]);
};

/** Fallback profissional, com as mesmas cores usadas na rota. */
export const MapUnavailableFallback: React.FC<{ onRetry: () => void }> = ({
  onRetry,
}) => {
  const navigate = useNavigate();
  const { theme } = useHomeTheme();
  const isDay = theme === 'light';
  const paper = isDay ? '#F7F5EF' : '#0B1410';
  const ink = isDay ? '#0B1410' : '#F7F5EF';
  const inner = isDay ? 'rgba(11,20,16,0.05)' : 'rgba(247,245,239,0.06)';

  return (
    <div
      role="alert"
      data-testid="map-unavailable-fallback"
      className="fixed inset-0 z-[120] flex items-center justify-center px-6"
      style={{ background: paper, color: ink }}
    >
      <div
        className="w-full max-w-sm rounded-[32px] p-8 text-center"
        style={{
          background: paper,
          border: `1px solid ${ink}1A`,
          boxShadow: isDay
            ? '0 20px 50px rgba(11,20,16,0.12)'
            : '0 25px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: '#31D880', color: '#0B1410' }}
        >
          <MapPin className="w-7 h-7" strokeWidth={2.4} />
        </div>

        <h2
          className="text-xl font-extrabold mb-2"
          style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}
        >
          {MAP_UNAVAILABLE_TITLE}
        </h2>

        <p className="text-sm leading-relaxed mb-6" style={{ opacity: 0.65 }}>
          {MAP_UNAVAILABLE_MESSAGE}
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={onRetry}
            className="w-full h-12 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
            style={{
              background: '#31D880',
              color: '#0B1410',
              fontFamily: 'Space Grotesk, sans-serif',
            }}
          >
            <RefreshCw className="w-4 h-4" strokeWidth={2.6} />
            Tentar novamente
          </button>
          <button
            onClick={() => navigate('/inicio')}
            className="w-full h-12 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
            style={{
              background: inner,
              color: ink,
              border: `1px solid ${ink}1A`,
              fontFamily: 'Space Grotesk, sans-serif',
            }}
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2.6} />
            Voltar para a Home
          </button>
        </div>
      </div>
    </div>
  );
};

interface BoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface BoundaryState {
  failed: boolean;
}

/** Rede de segurança: exceções de render/efeito viram fallback, não tela branca. */
class MapErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Nunca registramos token, URL com token ou conteúdo de import.meta.env.
    console.error(
      'Mapbox: erro ao renderizar a rota.',
      error instanceof Error ? error.message : 'erro desconhecido',
    );
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export const MapboxGuard: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [status, setStatus] = useState<MapStatus>(
    hasMapboxToken ? 'loading' : 'missing-config',
  );
  const [attempt, setAttempt] = useState(0);

  const report = useCallback<ReportMapStatus>((next) => setStatus(next), []);

  const retry = useCallback(() => {
    setStatus(hasMapboxToken ? 'loading' : 'missing-config');
    setAttempt((value) => value + 1);
  }, []);

  const unavailable = !hasMapboxToken || isMapUnavailable(status);

  return (
    <MapStatusContext.Provider value={report}>
      {unavailable ? (
        <MapUnavailableFallback onRetry={retry} />
      ) : (
        <MapErrorBoundary
          key={attempt}
          fallback={<MapUnavailableFallback onRetry={retry} />}
        >
          {children}
        </MapErrorBoundary>
      )}
    </MapStatusContext.Provider>
  );
};
