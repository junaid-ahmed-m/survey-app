import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import {
  CreateCouponTypeDto,
  ImportCouponsDto,
  ListCouponsQueryDto,
  UpdateCouponTypeDto,
} from './dto/coupon.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../common/constants';

@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get('types')
  @RequirePermissions(PERMISSIONS.COUPONS_VIEW)
  listTypes() {
    return this.coupons.listTypes();
  }

  @Post('types')
  @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  createType(@Body() dto: CreateCouponTypeDto) {
    return this.coupons.createType(dto);
  }

  @Patch('types/:code')
  @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  updateType(@Param('code') code: string, @Body() dto: UpdateCouponTypeDto) {
    return this.coupons.updateType(code, dto);
  }

  @Post('import')
  @RequirePermissions(PERMISSIONS.COUPONS_IMPORT)
  import(@Body() dto: ImportCouponsDto) {
    return this.coupons.importCoupons(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.COUPONS_VIEW)
  list(@Query() query: ListCouponsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const revealEmails =
      query.reveal === 'true' && user.permissions.includes(PERMISSIONS.EMAILS_REVEAL);
    return this.coupons.listCoupons(query, revealEmails);
  }

  /** Step-up read for a single coupon code. */
  @Get(':id/reveal')
  @RequirePermissions(PERMISSIONS.COUPONS_REVEAL)
  reveal(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.coupons.revealCoupon(id, user.id);
  }
}
