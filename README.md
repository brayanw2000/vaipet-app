# VaiPet App

Portal para donos de pets e PetWalkers.

## Tecnologias

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
- Lovable Cloud (Supabase)

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha os valores (nunca comite valores reais).

| Variável | Descrição |
| --- | --- |
| `VITE_SUPABASE_URL` | URL do projeto Supabase. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública (anon) do Supabase. |
| `VITE_SUPABASE_PROJECT_ID` | ID do projeto Supabase. |
| `VITE_MAPBOX_TOKEN` | Token **público** (`pk.*`) do Mapbox usado pelo mapa da Home e pela tela `/search-walk`. Sem ele o app renderiza o fallback de mapa — nunca uma tela branca. Nunca use um secret aqui. |
| `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` | Chave browser do conector Google Maps. |
| `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID` | Tracking ID do conector Google Maps. |

> Adicione `VITE_MAPBOX_TOKEN=` (vazio) ao `.env.example` ao documentar novos ambientes.

## Instalação

```sh
npm install
npm run dev
```

## Publicação

Abra o Lovable e clique em Share -> Publish.
