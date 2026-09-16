import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RedeemService } from './redeem.service';
import { CompleteRedemptionDto, VerifyCodeDto } from './dto/redeem.dto';
import { Public } from '../common/decorators/public.decorator';

/**
 * Public, unauthenticated endpoints reached from the QR code.
 * Every route is aggressively rate limited because the URL is open to the world.
 */
@Public()
@Controller('public/redeem')
export class RedeemController {
  constructor(private readonly redeem: RedeemService) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ redeem: { limit: 10, ttl: 60_000 }, burst: { limit: 3, ttl: 5_000 } })
  verify(@Body() dto: VerifyCodeDto, @Ip() ip: string) {
    return this.redeem.verify(dto, ip);
  }

  @Get('session/:token')
  @Throttle({ redeem: { limit: 30, ttl: 60_000 } })
  session(@Param('token') token: string) {
    return this.redeem.getSession(token);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ redeem: { limit: 10, ttl: 60_000 }, burst: { limit: 3, ttl: 5_000 } })
  complete(@Body() dto: CompleteRedemptionDto, @Ip() ip: string) {
    return this.redeem.complete(dto, ip);
  }
}
