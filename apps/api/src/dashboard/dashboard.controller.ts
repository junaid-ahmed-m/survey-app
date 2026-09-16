import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../common/constants';

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('stats')
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  overview() {
    return this.dashboard.overview();
  }

  @Get('responses')
  @RequirePermissions(PERMISSIONS.RESPONSES_VIEW)
  responses(
    @Query() query: { batchId?: string; page?: string; pageSize?: string; reveal?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const reveal =
      query.reveal === 'true' && user.permissions.includes(PERMISSIONS.EMAILS_REVEAL);
    return this.dashboard.responses(query, reveal);
  }

  /** E-mails stay masked in the file unless the caller may also reveal them. */
  @Get('responses/export.csv')
  @RequirePermissions(PERMISSIONS.RESPONSES_VIEW, PERMISSIONS.RESPONSES_EXPORT)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportResponses(
    @Query() query: { batchId?: string },
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const csv = await this.dashboard.exportResponsesCsv(
      query,
      user.permissions.includes(PERMISSIONS.EMAILS_REVEAL),
      user,
    );
    res.setHeader('Content-Disposition', 'attachment; filename="survey-responses.csv"');
    res.send(csv);
  }
}
