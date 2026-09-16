import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const config = app.get(ConfigService);

  // Rate limiting keys on req.ip, so this must match the real number of proxies
  // in front of the API. Trusting a hop that does not exist would let a client
  // forge X-Forwarded-For and get an unlimited number of buckets.
  const trustProxyHops = config.get<number>('trustProxyHops') ?? 0;
  app.set('trust proxy', trustProxyHops > 0 ? trustProxyHops : false);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.get<string[]>('corsOrigins'),
    credentials: true,
  });

  // Survey answers are free-form JSON; cap the payload well below the Express
  // default so a single request cannot push megabytes into the database.
  const maxBodySize = config.get<string>('maxBodySize') ?? '64kb';
  app.useBodyParser('json', { limit: maxBodySize });
  app.useBodyParser('urlencoded', { limit: maxBodySize, extended: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.get(PrismaService).enableShutdownHooks(app);

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`API ready on http://localhost:${port}/api`);
}

void bootstrap();
