alter table public.project_spatial_layers
add column if not exists style_config jsonb not null default '{
  "fillColor": "#64748b",
  "strokeColor": "#475569",
  "fillOpacity": 0.18,
  "strokeOpacity": 0.74,
  "strokeWidth": 1.2
}'::jsonb;
