import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import type { LocationEvent } from '@sugat/shared-types';
import { authenticatedFetch } from '../api/client';
import { trackingConfig } from './config';

const TASK='sugat-active-trip-location',QUEUE='sugat-location-queue',TRIP='sugat-active-trip',LAST_UPLOAD='sugat-last-location-upload';
let syncPromise:Promise<number>|null=null;

async function readQueue():Promise<LocationEvent[]>{try{return JSON.parse((await AsyncStorage.getItem(QUEUE))??'[]')}catch{return[]}}
async function writeQueue(events:LocationEvent[]){await AsyncStorage.setItem(QUEUE,JSON.stringify(events.slice(-trackingConfig.maxQueueSize)))}
async function enqueue(event:LocationEvent){const prior=await readQueue();if(!prior.some(x=>x.eventId===event.eventId))await writeQueue([...prior,event]);}
const payload=(e:LocationEvent)=>({eventId:e.eventId,latitude:e.latitude,longitude:e.longitude,accuracy:e.accuracy,speed:e.speed,heading:e.heading,recordedAt:e.recordedAt});

export async function syncQueue(tripId?:string){if(syncPromise)return syncPromise;syncPromise=(async()=>{const activeTrip=tripId??await AsyncStorage.getItem(TRIP);if(!activeTrip)return 0;let queue=await readQueue(),sent=0;while(true){const batch=queue.filter(e=>e.tripId===activeTrip).slice(0,trackingConfig.syncBatchSize);if(!batch.length)break;const r=await authenticatedFetch(`/driver/trips/${activeTrip}/locations/batch`,{method:'POST',body:JSON.stringify({events:batch.map(payload)})});if(!r.ok)throw new Error(`GPS synchronization failed (${r.status})`);const ids=new Set(batch.map(e=>e.eventId));queue=queue.filter(e=>!ids.has(e.eventId));await writeQueue(queue);sent+=batch.length;await AsyncStorage.setItem(LAST_UPLOAD,new Date().toISOString())}return sent})().finally(()=>{syncPromise=null});return syncPromise;}

TaskManager.defineTask(TASK,async({data,error})=>{if(error||!data)return;const tripId=await AsyncStorage.getItem(TRIP);if(!tripId)return;for(const l of(data as{locations:Location.LocationObject[]}).locations){await enqueue({eventId:`${tripId}:${l.timestamp}:${l.coords.latitude.toFixed(6)}:${l.coords.longitude.toFixed(6)}`,tripId,latitude:l.coords.latitude,longitude:l.coords.longitude,accuracy:l.coords.accuracy??999,speed:l.coords.speed??undefined,heading:l.coords.heading??undefined,recordedAt:new Date(l.timestamp).toISOString()})}try{await syncQueue(tripId)}catch{/* The durable queue is retried by connectivity/app recovery. */}});

export async function requestTrackingPermissions(){const services=await Location.hasServicesEnabledAsync();if(!services)return{granted:false,reason:'Location Services are disabled. Enable Location in device Settings.'};const fg=await Location.requestForegroundPermissionsAsync();if(fg.status!=='granted')return{granted:false,reason:'Precise location permission is required. Enable Location for SUGAT Driver in Settings.'};const bg=await Location.requestBackgroundPermissionsAsync();if(bg.status!=='granted')return{granted:false,reason:Platform.OS==='ios'?'Set Location to Always in iPhone Settings so tracking continues during an active trip.':'Set Location permission to Allow all the time in Android Settings so tracking continues with the screen locked.'};return{granted:true as const};}
export async function startTracking(tripId:string){await AsyncStorage.setItem(TRIP,tripId);if(await Location.hasStartedLocationUpdatesAsync(TASK))return;await Location.startLocationUpdatesAsync(TASK,{accuracy:Location.Accuracy.High,timeInterval:trackingConfig.movingIntervalMs,distanceInterval:trackingConfig.distanceIntervalMeters,activityType:Location.ActivityType.AutomotiveNavigation,pausesUpdatesAutomatically:false,showsBackgroundLocationIndicator:true,foregroundService:{notificationTitle:'SUGAT trip tracking active',notificationBody:'Location is shared only for your active trip.'}});}
export async function restoreTracking(tripId:string){await AsyncStorage.setItem(TRIP,tripId);if(!await Location.hasStartedLocationUpdatesAsync(TASK)){const bg=await Location.getBackgroundPermissionsAsync();if(bg.status==='granted')await startTracking(tripId)}}
export async function stopTracking(){if(await Location.hasStartedLocationUpdatesAsync(TASK))await Location.stopLocationUpdatesAsync(TASK);await AsyncStorage.removeItem(TRIP)}
export async function trackingStatus(){const[tripId,queue,lastUpload,running]=await Promise.all([AsyncStorage.getItem(TRIP),readQueue(),AsyncStorage.getItem(LAST_UPLOAD),Location.hasStartedLocationUpdatesAsync(TASK)]);return{tripId,queued:queue.filter(e=>!tripId||e.tripId===tripId).length,lastUpload,running}}
export async function clearCompletedTripQueue(tripId:string){const queue=await readQueue();await writeQueue(queue.filter(e=>e.tripId!==tripId))}
