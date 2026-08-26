import 'reflect-metadata';
import helmet from 'helmet';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { allowedOrigins, validateEnvironment } from './common/environment';
import { RedisIoAdapter } from './common/redis-io.adapter';

async function bootstrap() {
  validateEnvironment();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connect();
  app.useWebSocketAdapter(redisAdapter);
  app.use(helmet());
  app.enableCors({ origin: allowedOrigins(), credentials: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'readiness'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true') {
    const config = new DocumentBuilder().setTitle('Sugat API').setVersion('1').addBearerAuth().build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
  Logger.log(`SUGAT API listening on ${host}:${port}`, 'Bootstrap');
}
void bootstrap();
