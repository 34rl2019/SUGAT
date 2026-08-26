import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
@Controller()
export class HealthController {
  constructor(private db: PrismaService) {}
  @Get('health') health() { return { status: 'ok', time: new Date().toISOString() }; }
  @Get('readiness') async readiness() { await this.db.$queryRaw`SELECT 1`; return { status: 'ready' }; }
}
