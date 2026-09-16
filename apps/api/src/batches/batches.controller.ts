import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { BatchesService } from './batches.service';
import {
  CreateBatchDto,
  ListBatchesQueryDto,
  ListCodesQueryDto,
  PreviewCodeDto,
  UpdateBatchStatusDto,
} from './dto/batch.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('admin/batches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  @Post('preview')
  @RequirePermissions(PERMISSIONS.BATCHES_MANAGE)
  preview(@Body() dto: PreviewCodeDto) {
    return this.batches.previewStrength(dto);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BATCHES_MANAGE)
  create(@Body() dto: CreateBatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.batches.create(dto, user.id);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.BATCHES_VIEW)
  list(@Query() query: ListBatchesQueryDto) {
    return this.batches.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BATCHES_VIEW)
  findOne(@Param('id') id: string) {
    return this.batches.findOne(id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.BATCHES_MANAGE)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateBatchStatusDto) {
    return this.batches.updateStatus(id, dto);
  }

  /** Codes are always masked here - clear text needs an explicit reveal call. */
  @Get(':id/codes')
  @RequirePermissions(PERMISSIONS.BATCHES_VIEW)
  listCodes(@Param('id') id: string, @Query() query: ListCodesQueryDto) {
    return this.batches.listCodes(id, query);
  }

  /** Step-up read: one code at a time, audit-logged. */
  @Get('codes/:codeId/reveal')
  @RequirePermissions(PERMISSIONS.CODES_REVEAL)
  reveal(@Param('codeId') codeId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.batches.revealCode(codeId, user.id);
  }

  @Get(':id/export.csv')
  @RequirePermissions(PERMISSIONS.CODES_EXPORT)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    res.setHeader('Content-Disposition', `attachment; filename="batch-${id}-codes.csv"`);
    // Honour back-pressure: a slow client must not make the server buffer the
    // whole file in memory.
    const write = (chunk: string) =>
      new Promise<void>((resolve, reject) => {
        if (res.write(chunk)) return resolve();
        res.once('error', reject);
        res.once('drain', resolve);
      });

    await this.batches.streamCsv(id, user, write);
    res.end();
  }

  @Get('codes/:codeId/qr')
  @RequirePermissions(PERMISSIONS.CODES_REVEAL)
  qr(@Param('codeId') codeId: string) {
    return this.batches.qrDataUrl(codeId);
  }

  @Get('codes/:codeId/qr.png')
  @RequirePermissions(PERMISSIONS.CODES_REVEAL, PERMISSIONS.CODES_EXPORT)
  async qrPng(@Param('codeId') codeId: string, @Res() res: Response) {
    const { code, buffer } = await this.batches.qrPngBuffer(codeId);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${code}.png"`);
    res.send(buffer);
  }
}
