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
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('admin/batches')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  @Post('preview')
  preview(@Body() dto: PreviewCodeDto) {
    return this.batches.previewStrength(dto);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateBatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.batches.create(dto, user.id);
  }

  @Get()
  list(@Query() query: ListBatchesQueryDto) {
    return this.batches.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.batches.findOne(id);
  }

  @Patch(':id/status')
  @Roles('ADMIN')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateBatchStatusDto) {
    return this.batches.updateStatus(id, dto);
  }

  @Get(':id/codes')
  listCodes(@Param('id') id: string, @Query() query: ListCodesQueryDto) {
    return this.batches.listCodes(id, query);
  }

  @Get(':id/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.batches.exportCsv(id);
    res.setHeader('Content-Disposition', `attachment; filename="batch-${id}-codes.csv"`);
    res.send(csv);
  }

  @Get('codes/:codeId/qr')
  qr(@Param('codeId') codeId: string) {
    return this.batches.qrDataUrl(codeId);
  }

  @Get('codes/:codeId/qr.png')
  async qrPng(@Param('codeId') codeId: string, @Res() res: Response) {
    const { code, buffer } = await this.batches.qrPngBuffer(codeId);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${code}.png"`);
    res.send(buffer);
  }
}
