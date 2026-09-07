import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { hideMapLabels, enrichMap, tintMapInk } from '@/lib/mapStyle';
import { cn } from '@/lib/utils';

interface PetwalkerMapProps {
  mapboxToken: string;
  isOnline: boolean;
  onMapLoad: (map: mapboxgl.Map) => void;
  className?: string;
  walkerCoords?: [number, number] | null;
  walkerAccuracy?: number | null;
  meetingCoords?: [number, number] | null;
}

export const PetwalkerMap = ({ 
  mapboxToken, 
  isOnline, 
  onMapLoad, 
  className,
  walkerCoords,
  walkerAccuracy,
  meetingCoords
}: PetwalkerMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const sourceId = 'walker-current-location';
  const meetingSourceId = 'meeting-location';
  const haloLayerId = 'walker-location-halo';
  const dotLayerId = 'walker-location-dot';
  const meetingLayerId = 'meeting-location-marker';

  // Initialize Map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = mapboxToken;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/standard",
      center: [0, 0],
      zoom: 1,
      pitch: 0,
      attributionControl: false,
    });

    map.current.on('load', () => {
      if (!map.current) return;
      hideMapLabels(map.current);
      enrichMap(map.current, true);
      tintMapInk(map.current, false);

      // Add Sources
      map.current.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addSource(meetingSourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Add Layers
      // Halo (Accuracy/Pulse)
      map.current.addLayer({
        id: haloLayerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 15, 16, 32],
          'circle-color': '#31D880',
          'circle-opacity': 0.2,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#31D880',
          'circle-stroke-opacity': 0.3
        }
      });

      // Dot (Walker Position)
      map.current.addLayer({
        id: dotLayerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 7,
          'circle-color': '#31D880',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff'
        }
      });

      // Meeting Marker
      map.current.addLayer({
        id: meetingLayerId,
        type: 'circle',
        source: meetingSourceId,
        paint: {
          'circle-radius': 8,
          'circle-color': '#000000',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff'
        }
      });

      onMapLoad(map.current);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [mapboxToken]);

  // Update Walker Coords
  useEffect(() => {
    if (!map.current || !walkerCoords) return;
    const source = map.current.getSource(sourceId) as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: walkerCoords },
          properties: { accuracy: walkerAccuracy }
        }]
      });

      // Adjust halo radius based on accuracy if available
      if (walkerAccuracy && walkerAccuracy > 0) {
        const metersToPixelsAtMaxZoom = (meters: number, latitude: number, zoom: number) => {
          return meters / (78271.484 * Math.cos(latitude * Math.PI / 180) / Math.pow(2, zoom));
        };
        // We limit visual halo to avoid covering everything, but make it reflect accuracy somewhat
        const radiusPx = Math.min(60, Math.max(20, walkerAccuracy / 2));
        map.current.setPaintProperty(haloLayerId, 'circle-radius', radiusPx);
      }
    }
  }, [walkerCoords, walkerAccuracy]);

  // Update Meeting Coords
  useEffect(() => {
    if (!map.current) return;
    const source = map.current.getSource(meetingSourceId) as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: meetingCoords ? [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: meetingCoords },
          properties: {}
        }] : []
      });
    }
  }, [meetingCoords]);

  return (
    <div 
      ref={mapContainer} 
      className={cn("absolute inset-0 z-0 transition-opacity duration-500", !isOnline && "opacity-[0.88]", className)} 
    />
  );
};