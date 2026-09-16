import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants';

@Controller('admin/roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  catalog() {
    return this.roles.catalog();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  list() {
    return this.roles.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Patch(':name')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  update(@Param('name') name: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(name.toUpperCase(), dto);
  }

  @Delete(':name')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  remove(@Param('name') name: string) {
    return this.roles.remove(name.toUpperCase());
  }
}
