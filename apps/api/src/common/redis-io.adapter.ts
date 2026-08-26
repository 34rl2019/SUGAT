import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';
import { allowedOrigins } from './environment';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger=new Logger(RedisIoAdapter.name);
  private adapterConstructor?:ReturnType<typeof createAdapter>;
  private clients:Redis[]=[];
  constructor(app:INestApplicationContext){super(app)}
  async connect(){const url=process.env.REDIS_URL;if(!url)return;try{const pub=new Redis(url,{lazyConnect:true,maxRetriesPerRequest:1,retryStrategy:times=>Math.min(times*500,5000)}),sub=pub.duplicate();this.clients=[pub,sub];await Promise.all([pub.connect(),sub.connect()]);this.adapterConstructor=createAdapter(pub,sub);this.logger.log('Socket.IO Redis adapter connected')}catch(error){this.logger.error('Redis unavailable; using in-process Socket.IO adapter until API restart',error instanceof Error?error.stack:undefined);await Promise.allSettled(this.clients.map(c=>c.quit()));this.clients=[]}}
  createIOServer(port:number,options?:ServerOptions){const server=super.createIOServer(port,{...options,cors:{origin:allowedOrigins(),credentials:true}});if(this.adapterConstructor)server.adapter(this.adapterConstructor);return server}
  async close(){await Promise.allSettled(this.clients.map(c=>c.quit()))}
}
