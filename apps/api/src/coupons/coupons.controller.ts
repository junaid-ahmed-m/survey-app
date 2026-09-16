import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import {
  CreateCouponTypeDto,
  ImportCouponsDto,
  ListCouponsQueryDto,
  UpdateCouponTypeDto,
} from './dto/coupon.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get('types')
  listTypes() {
    return this.coupons.listTypes();
  }

  @Post('types')
  @Roles('ADMIN')
  createType(@Body() dto: CreateCouponTypeDto) {
    return this.coupons.createType(dto);
  }

  @Patch('types/:code')
  @Roles('ADMIN')
  updateType(@Param('code') code: string, @Body() dto: UpdateCouponTypeDto) {
    return this.coupons.updateType(code, dto);
  }

  @Post('import')
  @Roles('ADMIN')
  import(@Body() dto: ImportCouponsDto) {
    return this.coupons.importCoupons(dto);
  }

  @Get()
  list(@Query() query: ListCouponsQueryDto) {
    return this.coupons.listCoupons(query);
  }
}
