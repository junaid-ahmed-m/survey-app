import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('stats')
  overview() {
    return this.dashboard.overview();
  }

  @Get('responses')
  responses(@Query() query: { batchId?: string; page?: string; pageSize?: string }) {
    return this.dashboard.responses(query);
  }
}
