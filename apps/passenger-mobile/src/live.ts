import { io } from 'socket.io-client';
export const connectToTrip=(url:string,tripId:string,token?:string)=>{const socket=io(`${url}/live`,{auth:{token},transports:['websocket']});socket.on('connect',()=>socket.emit('trip.subscribe',{tripId}));return{socket,unsubscribe:()=>socket.emit('trip.unsubscribe',{tripId})};};
