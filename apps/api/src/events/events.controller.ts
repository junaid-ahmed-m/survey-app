import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { EventsService } from './events.service';
import { ListEventDeliveriesQueryDto } from './dto/event.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../common/constants';

@Controller('admin/events')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  list(@Query() query: ListEventDeliveriesQueryDto) {
    return this.events.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EVENTS_VIEW)
  findOne(@Param('id') id: string) {
    return this.events.findOne(id);
  }

  @Post(':id/retry')
  @RequirePermissions(PERMISSIONS.EVENTS_MANAGE)
  retry(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.events.retry(id, user.id);
  }
}
