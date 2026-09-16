import { IsIn, IsOptional, IsString } from 'class-validator';
import { EVENT_DELIVERY_STATUSES } from '../../common/constants';

export class ListEventDeliveriesQueryDto {
  @IsOptional()
  @IsIn(EVENT_DELIVERY_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
