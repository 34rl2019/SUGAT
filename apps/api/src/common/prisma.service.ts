import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { assertDatabaseUtc, utcDatabaseUrl } from './database-utc';
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() { super({ datasourceUrl: utcDatabaseUrl(process.env.DATABASE_URL) }); }
  async onModuleInit() {
    await this.$connect();
    try { await this.assertUtc(); } catch (error) { await this.$disconnect(); throw error; }
  }
  async assertUtc() { await assertDatabaseUtc(this); }
  async onModuleDestroy() { await this.$disconnect(); }
}
