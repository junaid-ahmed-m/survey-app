import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SurveysService } from './surveys.service';
import { CreateSurveyDto, UpdateSurveyDto } from './dto/survey.dto';
import { EventsService } from '../events/events.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../common/constants';

@Controller('admin/surveys')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SurveysController {
  constructor(
    private readonly surveys: SurveysService,
    private readonly events: EventsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SURVEYS_VIEW)
  list() {
    return this.surveys.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SURVEYS_VIEW)
  findOne(@Param('id') id: string) {
    return this.surveys.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  create(@Body() dto: CreateSurveyDto) {
    return this.surveys.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateSurveyDto) {
    return this.surveys.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  remove(@Param('id') id: string) {
    return this.surveys.remove(id);
  }

  /** Fires a sample event at the configured destination so it can be verified. */
  @Post(':id/forwarding/test')
  @RequirePermissions(PERMISSIONS.SURVEYS_MANAGE)
  async testForwarding(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const forwarding = await this.surveys.getForwarding(id);
    if (!forwarding) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Survey not found.' });
    }
    return this.events.sendTest(forwarding.config, user.id, forwarding.title);
  }
}
