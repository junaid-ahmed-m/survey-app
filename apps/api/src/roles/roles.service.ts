import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { ALL_PERMISSIONS, PERMISSION_CATALOG, SUPER_ADMIN_ROLE } from '../common/constants';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  private parse(permissions: string): string[] {
    try {
      const parsed = JSON.parse(permissions) as string[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  catalog() {
    return { groups: PERMISSION_CATALOG, all: ALL_PERMISSIONS };
  }

  async list() {
    const [roles, users] = await Promise.all([
      this.prisma.role.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] }),
      this.prisma.adminUser.groupBy({ by: ['role'], _count: { _all: true } }),
    ]);

    return roles.map((role) => ({
      name: role.name,
      description: role.description,
      permissions:
        role.name === SUPER_ADMIN_ROLE ? [...ALL_PERMISSIONS] : this.parse(role.permissions),
      isSystem: role.isSystem,
      userCount: users.find((u) => u.role === role.name)?._count._all ?? 0,
    }));
  }

  async create(dto: CreateRoleDto) {
    const name = dto.name.toUpperCase();
    const existing = await this.prisma.role.findUnique({ where: { name } });
    if (existing) {
      throw new ConflictException({ code: 'CONFLICT', message: 'A role with this name already exists.' });
    }
    await this.prisma.role.create({
      data: {
        name,
        description: dto.description,
        permissions: JSON.stringify(dto.permissions),
        isSystem: false,
      },
    });
    return this.findOne(name);
  }

  async findOne(name: string) {
    const role = await this.prisma.role.findUnique({ where: { name } });
    if (!role) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Role not found.' });
    }
    const userCount = await this.prisma.adminUser.count({ where: { role: role.name } });
    return {
      name: role.name,
      description: role.description,
      permissions:
        role.name === SUPER_ADMIN_ROLE ? [...ALL_PERMISSIONS] : this.parse(role.permissions),
      isSystem: role.isSystem,
      userCount,
    };
  }

  async update(name: string, dto: UpdateRoleDto) {
    const role = await this.findOne(name);
    if (role.name === SUPER_ADMIN_ROLE) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'The super admin role always holds every permission.',
      });
    }
    await this.prisma.role.update({
      where: { name: role.name },
      data: {
        description: dto.description,
        ...(dto.permissions ? { permissions: JSON.stringify(dto.permissions) } : {}),
      },
    });
    return this.findOne(role.name);
  }

  async remove(name: string) {
    const role = await this.findOne(name);
    if (role.isSystem) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'System roles cannot be deleted.' });
    }
    if (role.userCount > 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Move the users assigned to this role first.',
      });
    }
    await this.prisma.role.delete({ where: { name: role.name } });
    return { deleted: true };
  }
}
