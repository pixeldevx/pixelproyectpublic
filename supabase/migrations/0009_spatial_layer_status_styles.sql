alter table public.project_spatial_layers
alter column style_config set default '{
  "fillColor": "#64748b",
  "strokeColor": "#475569",
  "fillOpacity": 0.18,
  "strokeOpacity": 0.74,
  "strokeWidth": 1.2,
  "statusStyles": {
    "unlinked": { "fillColor": "#64748b", "strokeColor": "#475569" },
    "pending": { "fillColor": "#94a3b8", "strokeColor": "#64748b" },
    "not_started": { "fillColor": "#cbd5e1", "strokeColor": "#94a3b8" },
    "in_progress": { "fillColor": "#f97316", "strokeColor": "#ea580c" },
    "completed": { "fillColor": "#10b981", "strokeColor": "#059669" },
    "completed_late": { "fillColor": "#c2410c", "strokeColor": "#9a3412" },
    "stuck": { "fillColor": "#ef4444", "strokeColor": "#dc2626" }
  }
}'::jsonb;

update public.project_spatial_layers
set style_config = style_config || '{
  "statusStyles": {
    "unlinked": { "fillColor": "#64748b", "strokeColor": "#475569" },
    "pending": { "fillColor": "#94a3b8", "strokeColor": "#64748b" },
    "not_started": { "fillColor": "#cbd5e1", "strokeColor": "#94a3b8" },
    "in_progress": { "fillColor": "#f97316", "strokeColor": "#ea580c" },
    "completed": { "fillColor": "#10b981", "strokeColor": "#059669" },
    "completed_late": { "fillColor": "#c2410c", "strokeColor": "#9a3412" },
    "stuck": { "fillColor": "#ef4444", "strokeColor": "#dc2626" }
  }
}'::jsonb
where not (style_config ? 'statusStyles');
