import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(
    `Silpo family ration agent API listening on http://localhost:${port}`,
  );
  console.log(
    `POST http://localhost:${port}/agent/messages { sessionId, message }`,
  );
}

void bootstrap();
