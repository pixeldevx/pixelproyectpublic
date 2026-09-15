"use client"

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Minus, Plus } from 'lucide-react';

const TILE_SIZE = 256;
const MAX_TILE_ZOOM = 19;
const DEFAULT_CENTER = { latitude: 4.570868, longitude: -74.297333 };

export type InventoryMapPoint = {
  id: string;
  label: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  tone?: string;
  meta?: string;
};

type ProjectedPoint = { x: number; y: number };
type MapCoordinate = { latitude: number; longitude: number };

type InventoryLocationMapProps = {
  value?: Partial<MapCoordinate>;
  points?: InventoryMapPoint[];
  selectedPointId?: string | null;
  onChange?: (coordinate: MapCoordinate) => void;
  onPointClick?: (point: InventoryMapPoint) => void;
  heightClassName?: string;
  emptyLabel?: string;
  className?: string;
};

export const parseMapCoordinate = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

export const hasMapCoordinates = (item: { latitude?: number | string | null; longitude?: number | string | null }) =>
  parseMapCoordinate(item.latitude) !== null && parseMapCoordinate(item.longitude) !== null;

const clampLatitude = (latitude: number) => Math.max(-85.05112878, Math.min(85.05112878, latitude));
const clampLongitude = (longitude: number) => {
  let next = longitude;
  while (next < -180) next += 360;
  while (next > 180) next -= 360;
  return next;
};

const project = (coordinate: MapCoordinate, zoom: number): ProjectedPoint => {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const latitude = clampLatitude(coordinate.latitude);
  const sinLatitude = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((clampLongitude(coordinate.longitude) + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale,
  };
};

const unproject = (point: ProjectedPoint, zoom: number): MapCoordinate => {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const longitude = (point.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return {
    latitude: clampLatitude(latitude),
    longitude: clampLongitude(longitude),
  };
};

const getPointCoordinate = (point: InventoryMapPoint): MapCoordinate | null => {
  const latitude = parseMapCoordinate(point.latitude);
  const longitude = parseMapCoordinate(point.longitude);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
};

const getInitialCenter = (value?: Partial<MapCoordinate>, points: InventoryMapPoint[] = []) => {
  const valueLatitude = parseMapCoordinate(value?.latitude);
  const valueLongitude = parseMapCoordinate(value?.longitude);
  if (valueLatitude !== null && valueLongitude !== null) {
    return { latitude: valueLatitude, longitude: valueLongitude };
  }

  const coordinates = points
    .map(getPointCoordinate)
    .filter(Boolean) as MapCoordinate[];
  if (coordinates.length === 0) return DEFAULT_CENTER;

  return {
    latitude: coordinates.reduce((sum, coordinate) => sum + coordinate.latitude, 0) / coordinates.length,
    longitude: coordinates.reduce((sum, coordinate) => sum + coordinate.longitude, 0) / coordinates.length,
  };
};

export function InventoryLocationMap({
  value,
  points = [],
  selectedPointId,
  onChange,
  onPointClick,
  heightClassName = 'h-72',
  emptyLabel = 'Haz clic sobre el mapa para ubicar el activo.',
  className = '',
}: InventoryLocationMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const dragMovedRef = useRef(false);
  const [mapSize, setMapSize] = useState({ width: 800, height: 320 });
  const [zoom, setZoom] = useState(() => (points.length > 1 ? 5 : 13));
  const [center, setCenter] = useState<MapCoordinate>(() => getInitialCenter(value, points));
  const [dragState, setDragState] = useState<{
    startX: number;
    startY: number;
    centerPoint: ProjectedPoint;
    moved: boolean;
  } | null>(null);

  const valueCoordinate = useMemo(() => {
    const latitude = parseMapCoordinate(value?.latitude);
    const longitude = parseMapCoordinate(value?.longitude);
    if (latitude === null || longitude === null) return null;
    return { latitude, longitude };
  }, [value?.latitude, value?.longitude]);

  useEffect(() => {
    if (!mapRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setMapSize({
        width: Math.max(320, Math.round(entry.contentRect.width)),
        height: Math.max(220, Math.round(entry.contentRect.height)),
      });
    });
    observer.observe(mapRef.current);
    return () => observer.disconnect();
  }, []);

  const topLeft = useMemo(() => {
    const centerPoint = project(center, zoom);
    return {
      x: centerPoint.x - mapSize.width / 2,
      y: centerPoint.y - mapSize.height / 2,
    };
  }, [center, mapSize.height, mapSize.width, zoom]);

  const tiles = useMemo(() => {
    const tileZoom = Math.min(zoom, MAX_TILE_ZOOM);
    const maxTile = Math.pow(2, tileZoom);
    const startX = Math.floor(topLeft.x / TILE_SIZE);
    const endX = Math.floor((topLeft.x + mapSize.width) / TILE_SIZE);
    const startY = Math.max(0, Math.floor(topLeft.y / TILE_SIZE));
    const endY = Math.min(maxTile - 1, Math.floor((topLeft.y + mapSize.height) / TILE_SIZE));
    const nextTiles: Array<{ key: string; url: string; left: number; top: number }> = [];

    for (let tileX = startX; tileX <= endX; tileX += 1) {
      for (let tileY = startY; tileY <= endY; tileY += 1) {
        const wrappedX = ((tileX % maxTile) + maxTile) % maxTile;
        nextTiles.push({
          key: `${tileZoom}-${tileX}-${tileY}`,
          url: `https://tile.openstreetmap.org/${tileZoom}/${wrappedX}/${tileY}.png`,
          left: tileX * TILE_SIZE - topLeft.x,
          top: tileY * TILE_SIZE - topLeft.y,
        });
      }
    }

    return nextTiles;
  }, [mapSize.height, mapSize.width, topLeft.x, topLeft.y, zoom]);

  const renderedPoints = useMemo(() => {
    const sourcePoints = points.length > 0
      ? points
      : valueCoordinate
        ? [{ id: 'selected-location', label: 'Ubicación del activo', latitude: valueCoordinate.latitude, longitude: valueCoordinate.longitude }]
        : [];

    return sourcePoints
      .map((point) => {
        const coordinate = getPointCoordinate(point);
        if (!coordinate) return null;
        const projected = project(coordinate, zoom);
        return {
          point,
          left: projected.x - topLeft.x,
          top: projected.y - topLeft.y,
        };
      })
      .filter(Boolean) as Array<{ point: InventoryMapPoint; left: number; top: number }>;
  }, [points, topLeft.x, topLeft.y, valueCoordinate, zoom]);

  const handleMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    if (!onChange || dragState?.moved) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const coordinate = unproject({
      x: topLeft.x + event.clientX - bounds.left,
      y: topLeft.y + event.clientY - bounds.top,
    }, zoom);
    setCenter(coordinate);
    onChange(coordinate);
  };

  const handlePointerMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragState) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      dragMovedRef.current = true;
      setCenter(unproject({ x: dragState.centerPoint.x - dx, y: dragState.centerPoint.y - dy }, zoom));
      setDragState((current) => current ? { ...current, moved: true } : current);
    }
  };

  const handleZoom = (nextZoom: number) => setZoom(Math.max(2, Math.min(MAX_TILE_ZOOM, nextZoom)));

  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-sm ${className}`}>
      <div
        ref={mapRef}
        className={`relative select-none overflow-hidden ${heightClassName}`}
        role={onChange ? 'button' : 'img'}
        tabIndex={0}
        onClick={handleMapClick}
        onMouseDown={(event) => {
          dragMovedRef.current = false;
          setDragState({ startX: event.clientX, startY: event.clientY, centerPoint: project(center, zoom), moved: false });
        }}
        onMouseMove={handlePointerMove}
        onMouseUp={() => setDragState(null)}
        onMouseLeave={() => setDragState(null)}
        onWheel={(event) => {
          event.preventDefault();
          handleZoom(zoom + (event.deltaY > 0 ? -1 : 1));
        }}
      >
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            draggable={false}
            className="absolute h-64 w-64 max-w-none"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}

        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.06)_1px,transparent_1px)] bg-[size:48px_48px]" />

        {renderedPoints.map(({ point, left, top }) => {
          const selected = point.id === selectedPointId || (points.length === 0 && valueCoordinate);
          return (
            <button
              key={point.id}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onPointClick?.(point);
              }}
              className="absolute z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1 text-left"
              style={{ left, top }}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-white ${selected ? 'bg-indigo-600' : point.tone || 'bg-emerald-600'}`}>
                <MapPin size={18} fill="currentColor" />
              </span>
              <span className="max-w-44 truncate rounded bg-white/95 px-2 py-1 text-[11px] font-black text-slate-800 shadow ring-1 ring-slate-200">
                {point.label}
              </span>
            </button>
          );
        })}

        {renderedPoints.length === 0 && (
          <div className="absolute inset-x-4 bottom-4 rounded-xl border border-dashed border-indigo-200 bg-white/90 p-3 text-sm font-bold text-slate-600 shadow-sm">
            {emptyLabel}
          </div>
        )}

        <div className="absolute left-3 top-3 flex overflow-hidden rounded-lg bg-white shadow ring-1 ring-slate-200">
          <button type="button" onClick={(event) => { event.stopPropagation(); handleZoom(zoom + 1); }} className="p-2 text-slate-700 hover:bg-slate-50">
            <Plus size={16} />
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); handleZoom(zoom - 1); }} className="border-l border-slate-200 p-2 text-slate-700 hover:bg-slate-50">
            <Minus size={16} />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
        <span>© OpenStreetMap contributors</span>
        <span>Zoom {zoom}</span>
      </div>
    </div>
  );
}
