import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { deriveLocationFreshness, etaForFreshness, occupancyColor, occupancyLabel, VEHICLE_VERIFICATION_NOTICE, type PassengerRide as Result, type PassengerTripDetail as Detail, type Stop } from '@sugat/shared-types';
import { SUGAT_BRAND_NAME, SUGAT_BRAND_TAGLINE } from '@sugat/theme';
import '../../../packages/theme/src/web.css';
import './style.css';
import './refactor.css';
import './stop-picker.css';
import './brand.css';
import './pilot.css';
import { VehicleMap } from './VehicleMap';
import { trackOverview } from '../../../packages/shared-utils/src/passenger-tracking';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';
const SOCKET = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3000';
type SubscriptionResult = { ok: boolean; subscribed?: boolean; code?: string; message?: string };
const empty = 'No active trips found for this route.', error = 'Live data is currently unavailable. Please try again.';
const stopLabel = (stop: Stop) => `${stop.province ?? 'Other'} — ${stop.cityMunicipality ?? stop.name} — ${stop.name}`;

const routeEndpoints = (route: Result['route'] | Detail['route']) => {
  const stops = route.stops.map(entry => entry.stop);
  return {
    start: stops[0] ?? null,
    destination: stops[stops.length - 1] ?? null,
    via: stops.slice(1, -1),
  };
};

const routeTitle = (route: Result['route'] | Detail['route']) => {
  const { start, destination } = routeEndpoints(route);
  return start && destination
    ? `${start.name} → ${destination.name}`
    : route.name;
};

const routeVia = (route: Result['route'] | Detail['route']) =>
  routeEndpoints(route).via.map(stop => stop.name).join(' → ');

function Brand() { return <div className="text-brand"><strong>{SUGAT_BRAND_NAME}</strong><span>{SUGAT_BRAND_TAGLINE}</span></div>; }

function StopPicker({ label, stops, selectedId, onSelect }: { label: string; stops: Stop[]; selectedId: string; onSelect: (id: string) => void }) {
  const selected = stops.find(stop => stop.id === selectedId), [query, setQuery] = useState(selected ? stopLabel(selected) : '');
  useEffect(() => { if (!selectedId) setQuery(''); }, [selectedId]);
  const options = useMemo(() => stops.filter(stop => stopLabel(stop).toLowerCase().includes(query.toLowerCase())).slice(0, 12), [stops, query]);
  return <div className="stop-picker"><label>{label}</label><input value={query} placeholder={label === 'FROM' ? 'Search origin or boarding stop' : 'Search destination'} onChange={event => { setQuery(event.target.value); onSelect(''); }} onFocus={() => { if (selected) setQuery(''); }} />{query && !selectedId && <div className="stop-options">{options.length ? options.map(stop => <button type="button" key={stop.id} onClick={() => { onSelect(stop.id); setQuery(stopLabel(stop)); }}><strong>{stop.name}</strong><small>{stop.cityMunicipality} · {stop.province}</small></button>) : <p>No matching active stops.</p>}</div>}</div>;
}


async function get<T>(path:string):Promise<T>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch(API+path,{signal:controller.signal});if(!response.ok)throw Object.assign(new Error(error),{status:response.status});return await response.json()}finally{clearTimeout(timer)}
}
function App() {
  const [stops,setStops]=useState<Stop[]>([]),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [results,setResults]=useState<Result[]>([]),[detail,setDetail]=useState<Detail|null>(null);
  const [searchContext,setSearchContext]=useState<{fromStopId:string;toStopId:string;version:number}|null>(null);
  const [selected,setSelected]=useState<Result|null>(null),[loading,setLoading]=useState(false),[message,setMessage]=useState('Choose your starting point and destination.');
  const selection=useRef(selected);selection.current=selected;
  useEffect(()=>{void get<Stop[]>('/public/stops').then(setStops).catch(()=>setMessage(error))},[]);
  useEffect(()=>{
    if(!searchContext)return;
    setLoading(true);setResults([]);
    const socket=io(SOCKET+'/live',{transports:['websocket']});
    const tracker=trackOverview({socket,...searchContext,
      fetchRides:()=>get<Result[]>('/public/trips/search?'+new URLSearchParams({fromStopId:searchContext.fromStopId,toStopId:searchContext.toStopId})),
      changed:rides=>{setResults(rides);setLoading(false);setMessage(rides.length?'':empty)},
      failed:message=>{setMessage(message);setLoading(false)},
      completed:id=>{if(selection.current?.tripId===id){setSelected(null);setDetail(null);setMessage('This trip has completed.')}}
    });
    return()=>{tracker.dispose();socket.disconnect()};
  },[searchContext]);
  useEffect(()=>{
    if(!selected)return;
    const tripId=selected.tripId,socket=io(SOCKET+'/live',{transports:['websocket']});let disposed=false,busy=false,lastRefresh=0;
    const reconcile=async()=>{
      if(busy)return;busy=true;lastRefresh=Date.now();
      try{
        const value=await get<Detail>('/public/trips/'+tripId+'?'+new URLSearchParams({boardingStopId:selected.boardingStop.id,destinationStopId:selected.destinationStop.id}));
        if(disposed)return;
        setDetail(current=>{if(current?.id!==tripId)return value;return {...value,
          ...(Date.parse(current.location?.recordedAt??'')>(Date.parse(value.location?.recordedAt??'')||0)?{location:current.location}:{}),
          ...(Date.parse(current.occupancyUpdatedAt??'')>(Date.parse(value.occupancyUpdatedAt??'')||0)?{occupancyStatus:current.occupancyStatus,occupancyUpdatedAt:current.occupancyUpdatedAt}:{})
        }});
      }catch(caught){if(disposed)return;setMessage('Tracking updates are temporarily unavailable.');if((caught as {status?:number}).status===404){setDetail(null);setSelected(null);setResults(current=>current.filter(ride=>ride.tripId!==tripId));setMessage('This trip is no longer active.')}}finally{busy=false}
    };
    const subscribe=()=>socket.emit('trip.subscribe',{tripId},(ack:SubscriptionResult)=>{if(disposed)return;if(!ack?.ok){setMessage(ack?.message??error);void reconcile();return}void reconcile()});
    const location=(event:NonNullable<Detail['location']>&{tripId:string})=>{
      if(event.tripId!==tripId)return;
      setDetail(current=>current?.id===tripId&&Date.parse(event.recordedAt)>(Date.parse(current.location?.recordedAt??'')||0)?{...current,location:{...event,freshness:deriveLocationFreshness(event.recordedAt,Date.now(),current.freshnessPolicy)}}:current);
      if(Date.now()-lastRefresh>=15000)void reconcile();
    };
    const occupancy=(event:{tripId:string;occupancyStatus:Detail['occupancyStatus'];updatedAt:string})=>{if(event.tripId===tripId)setDetail(current=>current?.id===tripId&&Date.parse(event.updatedAt)>=(Date.parse(current.occupancyUpdatedAt??'')||0)?{...current,occupancyStatus:event.occupancyStatus,occupancyUpdatedAt:event.updatedAt}:current)};
    const completed=(event:{tripId:string})=>{if(event.tripId===tripId){setDetail(null);setSelected(null);setResults(current=>current.filter(ride=>ride.tripId!==tripId));setMessage('This trip has completed.')}};
    socket.on('connect',subscribe);socket.on('trip.location.updated',location);socket.on('trip.occupancy.updated',occupancy);socket.on('trip.completed',completed);
    void reconcile();const fallback=setInterval(()=>void reconcile(),30000);
    return()=>{disposed=true;clearInterval(fallback);socket.disconnect()};
  },[selected?.tripId]);
  useEffect(()=>{const timer=setInterval(()=>setDetail(current=>{
    if(!current?.location)return current;const freshness=deriveLocationFreshness(current.location.recordedAt,Date.now(),current.freshnessPolicy);
    return {...current,location:{...current.location,freshness},boardingEta:etaForFreshness(current.boardingEta,freshness),destinationEta:etaForFreshness(current.destinationEta,freshness),remainingTripTime:etaForFreshness(current.remainingTripTime,freshness)};
  }),5000);return()=>clearInterval(timer)},[]);
  const track=(result:Result)=>{setDetail(null);setSelected(result);setMessage('')};
  const search=()=>{if(!from||!to||from===to)return;setSelected(null);setDetail(null);setSearchContext({fromStopId:from,toStopId:to,version:Date.now()});setMessage('')};
  if(detail)return <main><header><button className="back" onClick={()=>{setSelected(null);setDetail(null)}}>← BACK TO RIDES</button><Brand/></header>
    <section className="track"><h1>{detail.vehicle.displayName}</h1><p>{routeTitle(detail.route)}</p>{routeVia(detail.route)&&<p><strong>Via:</strong> {routeVia(detail.route)}</p>}<p>{detail.route.direction}</p>
      {message&&<p role="status">{message}</p>}
      <VehicleMap vehicles={[{...detail,tripId:detail.id}]} stops={detail.route.stops.map(entry=>entry.stop)} onSelect={()=>{}}/>
      <section className="vehicle-identity" aria-label="Vehicle details"><strong>VEHICLE DETAILS</strong><span>Vehicle name: {detail.vehicle.displayName}</span><strong>Plate number: {detail.vehicle.plateNumber}</strong><span>Vehicle type: {detail.vehicle.type}</span>{detail.vehicle.conductionSticker&&<span>Conduction sticker: {detail.vehicle.conductionSticker}</span>}<span className="occupancy-status" style={{backgroundColor:occupancyColor(detail.occupancyStatus)}}>{occupancyLabel(detail.occupancyStatus)}</span><span>GPS {detail.location?.freshness??'OFFLINE'} · {detail.location?'Updated '+new Date(detail.location.recordedAt).toLocaleTimeString():'Waiting for GPS'}</span></section>
      <p className="verification-notice">{VEHICLE_VERIFICATION_NOTICE}</p>
      <div className="trip-info"><div><label>BOARDING ETA</label><strong>{detail.boardingEta?.display??'Unavailable'}</strong></div><div><label>DESTINATION ETA</label><strong>{detail.destinationEta?.display??'Unavailable'}</strong></div><div><label>NEXT STOP</label><strong>{detail.nextStop?.name??'Final destination'}</strong></div><div><label>TRIP STATUS</label><strong>{detail.status}</strong></div></div>
      <ol>{detail.route.stops.map(entry=><li key={entry.stop.id}>{entry.stop.name}</li>)}</ol>
    </section></main>;
  return <main><header><Brand/></header><section className="hero"><div className="hero-copy"><h1>Where are you going?</h1><p>Find and track buses and vans on your route.</p></div></section>
    <section className="search"><StopPicker label="FROM" stops={stops} selectedId={from} onSelect={setFrom}/><StopPicker label="TO" stops={stops} selectedId={to} onSelect={setTo}/>{from&&from===to&&<p>Choose two different stops.</p>}<button className="primary" disabled={!from||!to||from===to||loading} onClick={search}>{loading?'SEARCHING…':'FIND A RIDE'}</button></section>
    {message&&<p role="status">{message}</p>}{selected&&!detail&&<p role="status">Loading trip details… <button onClick={()=>setSelected(null)}>CANCEL</button></p>}
    {searchContext&&<section className="overview"><h2>Matching active rides</h2><VehicleMap vehicles={results} stops={stops.filter(stop=>[searchContext.fromStopId,searchContext.toStopId].includes(stop.id))} onSelect={id=>{const ride=results.find(ride=>ride.tripId===id);if(ride)track(ride)}}/></section>}
    <section className="results">{results.map(result=><article key={result.tripId}><div><h3>{result.vehicle.displayName}</h3><p>{result.vehicle.type} · {routeTitle(result.route)}</p>{routeVia(result.route)&&<p><strong>Via:</strong> {routeVia(result.route)}</p>}<p>{result.route.direction}</p><span className="occupancy-status" style={{backgroundColor:occupancyColor(result.occupancyStatus)}}>{occupancyLabel(result.occupancyStatus)}</span><p>GPS {result.freshness} · {result.lastUpdatedAt?'Updated '+new Date(result.lastUpdatedAt).toLocaleTimeString():'Waiting for GPS'}</p><small>{result.boardingEta.display} to {result.boardingStop.name}</small></div><button onClick={()=>track(result)}>VEHICLE DETAILS</button></article>)}</section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
