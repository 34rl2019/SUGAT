import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import type { Stop } from '@sugat/shared-types';
import { SUGAT_BRAND_TAGLINE, SUGAT_PASSENGER_HEADLINE } from '@sugat/theme';
import '../../../packages/theme/src/web.css';
import './style.css';
import './refactor.css';
import './stop-picker.css';
import './brand.css';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';
const SOCKET = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3000';
type Result = { tripId: string; vehicle: { type: string; displayName: string }; route: { name: string; direction: string }; boardingStop: Stop; distanceKm: number; eta: { display: string }; freshness: string; lastUpdatedAt: string };
type Detail = { id: string; status: string; vehicle: { type: string; displayName: string }; route: { name: string; direction: string; stops: { sequence: number; stop: Stop }[] }; nextStop: Stop | null; location: { latitude: number; longitude: number; freshness: string; recordedAt: string } | null };
const empty = 'No active trips found for this route.', error = 'Live data is currently unavailable. Please try again.';
const stopLabel = (stop: Stop) => `${stop.province ?? 'Other'} — ${stop.cityMunicipality ?? stop.name} — ${stop.name}`;

function StopPicker({ label, stops, selectedId, onSelect }: { label: string; stops: Stop[]; selectedId: string; onSelect: (id: string) => void }) {
  const selected = stops.find(stop => stop.id === selectedId), [query, setQuery] = useState(selected ? stopLabel(selected) : '');
  useEffect(() => { if (!selectedId) setQuery(''); }, [selectedId]);
  const options = useMemo(() => stops.filter(stop => stopLabel(stop).toLowerCase().includes(query.toLowerCase())).slice(0, 12), [stops, query]);
  return <div className="stop-picker"><label>{label}</label><input value={query} placeholder={label === 'FROM' ? 'Search origin or boarding stop' : 'Search destination'} onChange={event => { setQuery(event.target.value); onSelect(''); }} onFocus={() => { if (selected) setQuery(''); }} />{query && !selectedId && <div className="stop-options">{options.length ? options.map(stop => <button type="button" key={stop.id} onClick={() => { onSelect(stop.id); setQuery(stopLabel(stop)); }}><strong>{stop.name}</strong><small>{stop.cityMunicipality} · {stop.province}</small></button>) : <p>No matching active stops.</p>}</div>}</div>;
}

function App() {
  const [stops, setStops] = useState<Stop[]>([]), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [results, setResults] = useState<Result[]>([]), [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false), [message, setMessage] = useState('Pilia ang sinugdanan ug destinasyon.');
  useEffect(() => { fetch(`${API}/public/stops`).then(response => response.ok ? response.json() : Promise.reject()).then(setStops).catch(() => setMessage(error)); }, []);
  useEffect(() => {
    if (!detail) return; const socket = io(`${SOCKET}/live`, { transports: ['websocket'] });
    socket.on('connect', () => socket.emit('trip.subscribe', { tripId: detail.id }));
    socket.on('trip.location.updated', payload => setDetail(current => current ? { ...current, location: { latitude: payload.latitude, longitude: payload.longitude, freshness: 'LIVE', recordedAt: payload.recordedAt } } : current));
    socket.on('trip.completed', () => { setMessage('Nahuman na ang biyahe.'); setDetail(null); }); return () => { socket.disconnect(); };
  }, [detail?.id]);
  async function search() { if (!from || !to || from === to) return; setLoading(true); try { const response = await fetch(`${API}/public/trips/search?fromStopId=${from}&toStopId=${to}`); if (!response.ok) throw new Error(); const found = await response.json(); setResults(found); setMessage(found.length ? '' : empty); } catch { setMessage(error); } finally { setLoading(false); } }
  async function track(id: string) { setLoading(true); try { const response = await fetch(`${API}/public/trips/${id}`); if (!response.ok) throw new Error(); setDetail(await response.json()); } catch { setMessage(error); } finally { setLoading(false); } }
  if (detail) return <main><header><button className="back" onClick={() => setDetail(null)}>← BALIK</button><span className="logo">SUGAT</span><span className="live">● {detail.location?.freshness ?? 'LOCATION UNAVAILABLE'}</span></header><section className="track"><p className="eyebrow">TAN-AWA LIVE</p><h1>{detail.vehicle.displayName}</h1><p>{detail.route.name} · {detail.route.direction}</p><div className="map"><div className="marker">{detail.vehicle.type}</div><strong>{detail.location ? `${detail.location.latitude.toFixed(5)}, ${detail.location.longitude.toFixed(5)}` : 'Location unavailable'}</strong><small>{detail.location ? `Updated ${new Date(detail.location.recordedAt).toLocaleTimeString()}` : 'Waiting for GPS'}</small></div><div className="trip-info"><div><label>NEXT STOP</label><strong>{detail.nextStop?.name ?? 'Final destination'}</strong></div><div><label>STATUS</label><strong>{detail.status}</strong></div></div><ol>{detail.route.stops.map(stop => <li key={stop.stop.id}>{stop.stop.name}</li>)}</ol></section></main>;
  return <main>
    <header><img className="official-logo header-logo" src="/sugat-logo-official.png" alt="SUGAT" /><span className="brand-tagline">{SUGAT_BRAND_TAGLINE}</span><span className="live">● REAL-TIME COMMUNITY TRANSPORT</span></header>
    <section className="hero"><div className="hero-copy"><img className="official-logo hero-logo" src="/sugat-logo-official.png" alt="SUGAT" /><p className="brand-tagline hero-tagline">{SUGAT_BRAND_TAGLINE}</p><h1>{SUGAT_PASSENGER_HEADLINE}</h1><p>Track buses and vans in real time with SUGAT.</p><a className="hero-cta" href="#find-a-ride">FIND MY RIDE</a><div className="hero-benefits" aria-label="SUGAT passenger benefits"><span>● LIVE TRACKING</span><span>LESS WAITING</span><span>EASY TO USE</span></div></div></section>
    <section className="search" id="find-a-ride"><StopPicker label="FROM" stops={stops} selectedId={from} onSelect={setFrom} /><StopPicker label="TO" stops={stops} selectedId={to} onSelect={setTo} />{from && to && from === to && <p className="validation">Origin and destination must be different.</p>}<button className="primary" disabled={!from || !to || from === to || loading} onClick={search}>{loading ? 'NANGITA…' : 'FIND A RIDE'}</button></section>
    <section className="results"><h2>{results.length ? `${results.length} active nga biyahe` : message}</h2>{results.map(result => <article key={result.tripId}><div className={`badge ${result.freshness.toLowerCase()}`}>{result.vehicle.type}</div><div><h3>{result.vehicle.displayName}</h3><p>{result.route.name} · {result.route.direction}</p><small>{result.eta.display} to {result.boardingStop.name} · {result.distanceKm} km · {result.freshness} · Updated {new Date(result.lastUpdatedAt).toLocaleTimeString()}</small></div><button onClick={() => track(result.tripId)}>TAN-AWA LIVE</button></article>)}</section>
    <footer><img className="official-logo footer-logo" src="/sugat-logo-official.png" alt="SUGAT" /><strong>{SUGAT_BRAND_TAGLINE}</strong><span>Real-time community transportation visibility.</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
