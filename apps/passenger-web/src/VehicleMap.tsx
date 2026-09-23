import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { occupancyColor, occupancyLabel, type PassengerLocation, type OccupancyStatus, type Stop } from '@sugat/shared-types';

export type MapVehicle = { tripId: string; vehicle: { displayName: string; type: string }; occupancyStatus: OccupancyStatus | null; location: PassengerLocation | null };
export function VehicleMap({ vehicles, stops, onSelect }: { vehicles: MapVehicle[]; stops: Stop[]; onSelect: (tripId: string) => void }) {
  const container = useRef<HTMLDivElement>(null), map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>()), select = useRef(onSelect), fitted = useRef('');
  const [error, setError] = useState(''), [ready, setReady] = useState(false);
  select.current = onSelect;
  useEffect(() => {
    if (!container.current) return;
    try {
      const instance = new maplibregl.Map({ container: container.current, style: {
        version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      }, attributionControl: { compact: true } });
      map.current = instance;
      instance.addControl(new maplibregl.NavigationControl(), 'top-right');
      instance.on('load', () => setReady(true));
      instance.on('error', () => setError('Map tiles are unavailable. Vehicle details remain available below.'));
      const resize = new ResizeObserver(() => instance.resize()); resize.observe(container.current);
      return () => { resize.disconnect(); markers.current.forEach(marker => marker.remove()); markers.current.clear(); instance.remove(); map.current = null; };
    } catch { setError('This browser cannot display the map. Use the ride list below.'); }
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const visible = vehicles.filter(vehicle => vehicle.location);
    const ids = new Set(visible.map(vehicle => vehicle.tripId));
    markers.current.forEach((marker, id) => { if (!ids.has(id)) { marker.remove(); markers.current.delete(id); } });
    visible.forEach(vehicle => {
      let marker = markers.current.get(vehicle.tripId);
      if (!marker) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'vehicle-map-marker';
        button.addEventListener('click', () => select.current(vehicle.tripId));
        marker = new maplibregl.Marker({ element: button }).setLngLat([vehicle.location!.longitude, vehicle.location!.latitude]).addTo(instance); markers.current.set(vehicle.tripId, marker);
      }
      const location = vehicle.location!, label = `${vehicle.vehicle.displayName} · ${occupancyLabel(vehicle.occupancyStatus)} · GPS ${location.freshness}`;
      const element = marker.getElement(); element.textContent = `${vehicle.vehicle.type} · ${occupancyLabel(vehicle.occupancyStatus)}\nGPS ${location.freshness}`;
      element.setAttribute('aria-label', label); element.title = label;
      element.style.backgroundColor = occupancyColor(vehicle.occupancyStatus);
      element.style.opacity = location.freshness === 'LIVE' ? '1' : '.65';
      element.style.borderStyle = location.freshness === 'LIVE' ? 'solid' : 'dashed';
      marker.setLngLat([location.longitude, location.latitude]);
    });
    const key = [...ids].sort().join(',') + stops.map(stop => stop.id).join(',');
    if (fitted.current !== key) {
      const points = [...visible.map(vehicle => vehicle.location!), ...stops];
      if (points.length) {
        const bounds = new maplibregl.LngLatBounds(); points.forEach(point => bounds.extend([point.longitude, point.latitude]));
        instance.fitBounds(bounds, { padding: 65, maxZoom: 13, duration: 0 }); fitted.current = key;
      }
    }
  }, [vehicles, stops, ready]);
  return <section aria-label="Matching vehicle map"><div ref={container} className="geographic-map"/>{error&&<p role="status">{error}</p>}<p className="map-legend"><span>🟢 GREEN = VACANT</span><span>🔴 RED = FULL</span><span>Gray = availability unknown</span></p><p className="map-note">GPS STALE / OFFLINE markers show last known locations. Seat availability is separate from GPS freshness.</p>{vehicles.some(vehicle=>!vehicle.location)&&<p>Vehicles waiting for GPS appear in the ride list.</p>}</section>;
}
