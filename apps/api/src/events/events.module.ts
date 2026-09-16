import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventDispatcherService } from './event-dispatcher.service';

@Module({
  controllers: [EventsController],
  providers: [EventsService, EventDispatcherService],
  exports: [EventsService],
})
export class EventsModule {}
