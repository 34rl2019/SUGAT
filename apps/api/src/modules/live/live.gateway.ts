import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
@WebSocketGateway({namespace:'/live'})
export class LiveGateway {
 @WebSocketServer() server!:Server;
 constructor(private jwt:JwtService){}
 async handleConnection(client:Socket){const token=client.handshake.auth?.token;if(!token){client.data.public=true;return;}try{client.data.user=await this.jwt.verifyAsync(token,{secret:process.env.JWT_ACCESS_SECRET});}catch{client.disconnect(true);}}
 @SubscribeMessage('trip.subscribe') subscribe(@ConnectedSocket() client:Socket,@MessageBody() body:{tripId:string}){client.join(`trip:${body.tripId}`);return{event:'tracking.subscription.updated',data:{tripId:body.tripId,subscribed:true}};}
 @SubscribeMessage('admin.subscribe') subscribeAdmin(@ConnectedSocket() client:Socket){if(client.data.user?.role!=='ADMIN')return{event:'error',data:{message:'Admin authorization required'}};client.join('admin:operations');return{event:'admin.subscription.updated',data:{subscribed:true}};}
 publishLocation(tripId:string,payload:unknown){this.server.to(`trip:${tripId}`).emit('trip.location.updated',payload);this.server.to('admin:operations').emit('trip.location.updated',payload);}
 publishStarted(tripId:string){this.server.to('admin:operations').emit('trip.started',{tripId});}
 publishStop(tripId:string,type:string,payload:unknown){this.server.to(`trip:${tripId}`).emit(type==='STOP_ARRIVED'?'trip.stop.arrived':'trip.stop.approaching',payload);}
 publishEnded(tripId:string){const payload={tripId};this.server.to(`trip:${tripId}`).emit('trip.completed',payload);this.server.to('admin:operations').emit('trip.completed',payload);}
}
