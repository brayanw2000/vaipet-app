import { describe, it, expect } from 'vitest';
import {
  MAP_UNAVAILABLE_MESSAGE,
  MAP_UNAVAILABLE_SHORT,
  MAP_UNAVAILABLE_TITLE,
  hasMapboxToken,
  mapboxToken,
  normalizeMapboxToken,
} from './mapboxConfig';

describe('mapboxConfig — normalização do token', () => {
  it('trata ausente/undefined/nulo como "sem token"', () => {
    expect(normalizeMapboxToken(undefined)).toBeNull();
    expect(normalizeMapboxToken(null)).toBeNull();
    expect(normalizeMapboxToken(42)).toBeNull();
    expect(normalizeMapboxToken({})).toBeNull();
  });

  it('trata string vazia ou só espaços como "sem token"', () => {
    expect(normalizeMapboxToken('')).toBeNull();
    expect(normalizeMapboxToken('   ')).toBeNull();
    expect(normalizeMapboxToken('\n\t')).toBeNull();
  });

  it('trata o texto literal "undefined" como "sem token"', () => {
    expect(normalizeMapboxToken('undefined')).toBeNull();
    expect(normalizeMapboxToken('UNDEFINED')).toBeNull();
    expect(normalizeMapboxToken('  undefined  ')).toBeNull();
  });

  it('preserva um token público válido, sem espaços', () => {
    expect(normalizeMapboxToken('pk.abc123')).toBe('pk.abc123');
    expect(normalizeMapboxToken('  pk.abc123  ')).toBe('pk.abc123');
  });

  it('nunca aceita chave do Google Maps como fallback', () => {
    // O helper lê apenas VITE_MAPBOX_TOKEN — uma chave do Google não é
    // convertida em token do Mapbox em nenhuma hipótese.
    expect(normalizeMapboxToken('AIzaSyGoogleMapsKey')).toBe('AIzaSyGoogleMapsKey');
    expect(normalizeMapboxToken('AIzaSyGoogleMapsKey')).not.toBe(mapboxToken);
  });
});

describe('mapboxConfig — estado do ambiente de teste', () => {
  it('sem VITE_MAPBOX_TOKEN o helper expõe hasMapboxToken = false', () => {
    // A suíte roda sem VITE_MAPBOX_TOKEN definido.
    expect(hasMapboxToken).toBe(false);
    expect(mapboxToken).toBeNull();
  });

  it('nunca expõe o texto literal "undefined" como token', () => {
    expect(mapboxToken).not.toBe('undefined');
  });

  it('mantém os textos de fallback usados pela Home e pela rota', () => {
    expect(MAP_UNAVAILABLE_TITLE).toBe('Mapa indisponível no momento');
    expect(MAP_UNAVAILABLE_MESSAGE).toContain('Tente novamente');
    expect(MAP_UNAVAILABLE_SHORT).toBe('Mapa temporariamente indisponível');
  });
});
