import React, { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { BottomNavigation } from '@/components/BottomNavigation';
import { MapPin, Building2, Star } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import { hideMapLabels } from '@/lib/mapStyle';
import 'mapbox-gl/dist/mapbox-gl.css';

const Hotelaria = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [selectedHotel, setSelectedHotel] = useState<any>(null);

  // Mock data for hotels
  const hotels = [
    {
      id: 1,
      name: "Pet Hotel Premium",
      address: "Rua das Flores, 123",
      rating: 4.8,
      price: "R$ 80/dia",
      coordinates: [-49.2734, -25.4284] as [number, number],
      amenities: ["Piscina", "VeterinÃ¡rio 24h", "Playground"]
    },
    {
      id: 2,
      name: "Hotel Canino Luxo",
      address: "Av. dos Animais, 456",
      rating: 4.6,
      price: "R$ 120/dia",
      coordinates: [-49.2654, -25.4204] as [number, number],
      amenities: ["Spa", "Transporte", "CÃ¢meras 24h"]
    },
    {
      id: 3,
      name: "Resort Pet Friends",
      address: "Rua do Carinho, 789",
      rating: 4.9,
      price: "R$ 150/dia",
      coordinates: [-49.2814, -25.4364] as [number, number],
      amenities: ["Resort", "Agility", "Grooming"]
    }
  ];

  useEffect(() => {
    // Get user location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location: [number, number] = [
            position.coords.longitude,
            position.coords.latitude
          ];
          setUserLocation(location);
        },
        (error) => {
          console.error('Error getting location:', error);
          // Default to Curitiba coordinates
          setUserLocation([-49.2734, -25.4284]);
        }
      );
    } else {
      // Default to Curitiba coordinates
      setUserLocation([-49.2734, -25.4284]);
    }
  }, []);

  useEffect(() => {
    if (!mapContainer.current || !userLocation) return;

    // Set Mapbox access token (usando a mesma do SearchWalk)
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: userLocation,
      zoom: 12
    });
    map.current.on('load', () => map.current && hideMapLabels(map.current));

    // Add user location marker
    const userMarkerElement = document.createElement('div');
    userMarkerElement.className = 'w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg';
    
    new mapboxgl.Marker(userMarkerElement)
      .setLngLat(userLocation)
      .addTo(map.current);

    // Add hotel markers
    hotels.forEach(hotel => {
      const markerElement = document.createElement('div');
      markerElement.className = 'w-8 h-8 bg-[#31D880] rounded-full border-2 border-white shadow-lg flex items-center justify-center cursor-pointer hover:scale-110 transition-transform';
      markerElement.innerHTML = '<div class="w-4 h-4 text-white">ðŸ¨</div>';
      
      const marker = new mapboxgl.Marker(markerElement)
        .setLngLat(hotel.coordinates)
        .addTo(map.current!);

      // Add click event to marker
      markerElement.addEventListener('click', () => {
        setSelectedHotel(hotel);
      });
    });

    // Add navigation controls
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    return () => {
      map.current?.remove();
    };
  }, [userLocation]);

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto relative">
      {/* Header */}
      <div className="relative z-20">
        <Header />
      </div>

      {/* Map Container - ocupando toda a tela */}
      <div className="flex-1 relative">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        
        {/* Overlay com tÃ­tulo */}
        <div className="absolute top-4 left-4 right-4 z-10">
          <div className="bg-white/90 backdrop-blur-sm rounded-xl p-4 shadow-lg">
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#31D880]" />
              Hotelarias PrÃ³ximas
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {hotels.length} hotelarias encontradas na sua regiÃ£o
            </p>
          </div>
        </div>

        {/* Hotel Details Card */}
        {selectedHotel && (
          <div className="absolute bottom-28 left-4 right-4 z-10">
            <div className="bg-white rounded-xl p-4 shadow-lg border">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-semibold text-foreground">{selectedHotel.name}</h3>
                  <p className="text-sm text-muted-foreground">{selectedHotel.address}</p>
                </div>
                <button 
                  onClick={() => setSelectedHotel(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Ã—
                </button>
              </div>
              
              <div className="flex items-center gap-4 mb-3">
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-yellow-500 fill-current" />
                  <span className="text-sm font-medium">{selectedHotel.rating}</span>
                </div>
                <div className="text-sm font-semibold text-[#31D880]">
                  {selectedHotel.price}
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mb-3">
                {selectedHotel.amenities.map((amenity: string, index: number) => (
                  <span 
                    key={index}
                    className="bg-muted text-muted-foreground text-xs px-2 py-1 rounded-full"
                  >
                    {amenity}
                  </span>
                ))}
              </div>

              <button className="w-full bg-[#31D880] text-white py-2 rounded-lg font-medium hover:bg-[#31D880]/90 transition-colors">
                Reservar Agora
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="relative z-20">
        <BottomNavigation />
      </div>
    </div>
  );
};

export default Hotelaria;