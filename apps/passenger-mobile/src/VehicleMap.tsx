import MapLibreGL from '@maplibre/maplibre-react-native';
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { occupancyColor, occupancyLabel, type PassengerRide, type Stop } from '@sugat/shared-types';

const mapStyle = { version: 8 as const, sources: { osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }] };
type Vehicle = Pick<PassengerRide, 'tripId' | 'vehicle' | 'location' | 'occupancyStatus'>;
function VehicleAnnotation({ vehicle, onSelect }: { vehicle: Vehicle; onSelect: (tripId: string) => void }) {
  const annotation = useRef<React.ComponentRef<typeof MapLibreGL.PointAnnotation>>(null);
  const freshness = vehicle.location!.freshness;
  // Android caches annotation children as a bitmap; redraw changed status text/colors.
  useEffect(() => {
    const frame = requestAnimationFrame(() => annotation.current?.refresh());
    return () => cancelAnimationFrame(frame);
  }, [vehicle.occupancyStatus, freshness, vehicle.vehicle.type, vehicle.vehicle.displayName]);
  return <MapLibreGL.PointAnnotation ref={annotation} id={'vehicle-'+vehicle.tripId} coordinate={[vehicle.location!.longitude,vehicle.location!.latitude]} title={vehicle.vehicle.displayName} onSelected={()=>onSelect(vehicle.tripId)}>
    <View onLayout={()=>annotation.current?.refresh()} collapsable={false} accessible accessibilityLabel={vehicle.vehicle.displayName+', '+occupancyLabel(vehicle.occupancyStatus)+', GPS '+freshness} style={[styles.marker,{backgroundColor:occupancyColor(vehicle.occupancyStatus),opacity:freshness==='LIVE'?1:.65,borderStyle:freshness==='LIVE'?'solid':'dashed'}]}><Text style={styles.markerText}>{vehicle.vehicle.type} · {occupancyLabel(vehicle.occupancyStatus)}</Text><Text style={styles.markerText}>GPS {freshness}</Text></View>
  </MapLibreGL.PointAnnotation>;
}
export function VehicleMap({ vehicles, stops, onSelect, route = false }: { vehicles: Vehicle[]; stops: Stop[]; onSelect: (tripId: string) => void; route?: boolean }) {
  const visible = vehicles.filter(vehicle => vehicle.location);
  const membership = visible.map(vehicle=>vehicle.tripId).sort().join(',')+stops.map(stop=>stop.id).join(',');
  const bounds = useMemo(() => {
    const points = [...visible.map(vehicle=>vehicle.location!), ...stops];
    if (!points.length) return null;
    return { ne: [Math.max(...points.map(point=>point.longitude))+.005,Math.max(...points.map(point=>point.latitude))+.005], sw: [Math.min(...points.map(point=>point.longitude))-.005,Math.min(...points.map(point=>point.latitude))-.005], paddingTop: 55, paddingBottom: 55, paddingLeft: 45, paddingRight: 45 };
  }, [membership]);
  return <View><View style={styles.map}>{bounds?<MapLibreGL.MapView style={StyleSheet.absoluteFill} mapStyle={mapStyle} logoEnabled={false} attributionEnabled>
    <MapLibreGL.Camera bounds={bounds} animationDuration={0}/>
    {route&&stops.length>1&&<MapLibreGL.ShapeSource id="route" shape={{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:stops.map(stop=>[stop.longitude,stop.latitude])}}}><MapLibreGL.LineLayer id="route-line" style={{lineColor:'#c6a34a',lineWidth:3}}/></MapLibreGL.ShapeSource>}
    {stops.map(stop=><MapLibreGL.PointAnnotation key={stop.id} id={'stop-'+stop.id} coordinate={[stop.longitude,stop.latitude]} title={stop.name}><View collapsable={false} style={styles.stop}/></MapLibreGL.PointAnnotation>)}
    {visible.map(vehicle=><VehicleAnnotation key={vehicle.tripId} vehicle={vehicle} onSelect={onSelect}/>)}
  </MapLibreGL.MapView>:<Text>Waiting for location data.</Text>}</View><Text style={styles.note}>🟢 GREEN = VACANT · 🔴 RED = FULL{ '\n' }Gray = availability unknown. GPS STALE / OFFLINE indicates last known location.</Text>{vehicles.some(vehicle=>!vehicle.location)&&<Text style={styles.note}>Vehicles waiting for GPS appear in the ride list.</Text>}</View>;
}
const styles=StyleSheet.create({map:{height:340,overflow:'hidden',borderRadius:14,backgroundColor:'#e4e7ec'},marker:{padding:7,borderRadius:8,borderWidth:2,borderColor:'white',maxWidth:180},markerText:{color:'white',fontWeight:'700',fontSize:10},stop:{width:12,height:12,borderRadius:6,backgroundColor:'#142c46',borderWidth:2,borderColor:'white'},note:{fontSize:12,color:'#98a2b3',lineHeight:19,marginVertical:8}});
