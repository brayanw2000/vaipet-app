import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { User, MapPin, Clock, DollarSign, Calendar, Star, Route } from 'lucide-react';

interface WalkDetailsModalProps {
  walk: any;
  isOpen: boolean;
  onClose: () => void;
}

export const WalkDetailsModal: React.FC<WalkDetailsModalProps> = ({ walk, isOpen, onClose }) => {
  if (!walk) return null;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
  };

  // Usar valor real do service_request ou calcular baseado no tempo planejado
  const totalPrice = walk.total_price_cents ? (walk.total_price_cents / 100) : (walk.total_price || walk.service_requests?.total_price || 0);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md mx-auto max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900">
            Detalhes do Passeio
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Info do Passeador */}
          <div className="bg-gradient-to-r from-app-purple/5 to-app-orange/5 p-4 rounded-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 bg-[#0B1410] rounded-full flex items-center justify-center">
                <User className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">
                  {walk.provider?.full_name || 'Pet Walker'}
                </h3>
                <p className="text-sm text-gray-600">Passeador</p>
              </div>
            </div>
            {walk.provider?.rating && (
              <div className="flex items-center gap-1">
                <Star className="w-4 h-4 text-yellow-500 fill-current" />
                <span className="text-sm font-medium">{walk.provider.rating}</span>
                <span className="text-sm text-gray-500">
                  ({walk.provider.total_reviews} avaliações)
                </span>
              </div>
            )}
          </div>

          {/* Informações do Passeio */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-gray-500" />
              <div>
                <p className="font-medium text-gray-900">Data e Hora</p>
                <p className="text-sm text-gray-600">
                  {formatDate(walk.start_time || walk.created_at)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-gray-500" />
              <div>
                <p className="font-medium text-gray-900">Duração</p>
                <div className="text-sm text-gray-600 space-y-1">
                  <p>Duração solicitada: {formatDuration(walk.planned_duration_minutes)}</p>
                  <p>Duração real: {formatDuration(walk.actual_duration_minutes || walk.planned_duration_minutes)}</p>
                </div>
              </div>
            </div>

            {walk.distance_km > 0 && (
              <div className="flex items-center gap-3">
                <Route className="w-5 h-5 text-gray-500" />
                <div>
                  <p className="font-medium text-gray-900">Distância Percorrida</p>
                  <p className="text-sm text-gray-600">{walk.distance_km.toFixed(1)} km</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-gray-500" />
              <div>
                <p className="font-medium text-gray-900">Valor Pago</p>
                <p className="text-sm text-gray-600">
                  R$ {totalPrice.toFixed(2)}
                  <span className="text-xs text-gray-500 block">
                    *Baseado no tempo planejado ({formatDuration(walk.planned_duration_minutes)})
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-gray-500" />
              <div>
                <p className="font-medium text-gray-900">Status</p>
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    walk.current_status === 'completed' ? 'bg-green-500' : 
                    walk.current_status === 'returning' ? 'bg-yellow-500' : 
                    'bg-blue-500'
                  }`} />
                  <p className="text-sm text-gray-600 capitalize">{walk.current_status}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Rota */}
          {walk.route_coordinates && walk.route_coordinates.length > 0 && (
            <div className="bg-gray-50 p-4 rounded-2xl">
              <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <Route className="w-4 h-4" />
                Rota do Passeio
              </h4>
              <div className="bg-white p-3 rounded-lg border">
                <p className="text-sm text-gray-600">
                  {walk.route_coordinates.length} pontos registrados na rota
                </p>
                {/* Aqui você pode adicionar um mapa futuramente */}
                <div className="mt-2 h-32 bg-gray-100 rounded-lg flex items-center justify-center">
                  <p className="text-sm text-gray-500">Visualização do mapa em breve</p>
                </div>
              </div>
            </div>
          )}

          {/* Avaliação */}
          {walk.rating && (
            <div className="bg-yellow-50 p-4 rounded-2xl">
              <h4 className="font-semibold text-gray-900 mb-2">Sua Avaliação</h4>
              <div className="flex items-center gap-1 mb-2">
                {[...Array(5)].map((_, i) => (
                  <Star 
                    key={i} 
                    className={`w-4 h-4 ${
                      i < walk.rating ? 'text-yellow-500 fill-current' : 'text-gray-300'
                    }`} 
                  />
                ))}
                <span className="ml-2 text-sm font-medium">{walk.rating}/5</span>
              </div>
              {walk.review_comment && (
                <p className="text-sm text-gray-600">{walk.review_comment}</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};