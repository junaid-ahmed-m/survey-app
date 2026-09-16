import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SurveysService } from './surveys.service';
import { CreateSurveyDto, UpdateSurveyDto } from './dto/survey.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('admin/surveys')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get()
  list() {
    return this.surveys.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.surveys.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateSurveyDto) {
    return this.surveys.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateSurveyDto) {
    return this.surveys.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.surveys.remove(id);
  }
}
