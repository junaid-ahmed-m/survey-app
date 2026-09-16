import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SurveysService } from './surveys.service';
import { CreateSurveyDto, UpdateSurveyDto } from './dto/survey.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants';

@Controller('admin/surveys')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SurveysController {
  constructor(private readonly surveys: SurveysService) {}

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
}
