import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminUserDto, UpdateAdminUserDto } from './dto/user.dto';
import { maskEmail } from '../common/mask.util';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertRoleExists(role: string) {
    const exists = await this.prisma.role.findUnique({ where: { name: role } });
    if (!exists) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Unknown role.' });
    }
    return exists.name;
  }

  /** `revealEmails` is only true for callers holding `emails:reveal`. */
  async list(revealEmails: boolean) {
    const users = await this.prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map((user) => ({
      id: user.id,
      email: revealEmails ? user.email : null,
      maskedEmail: maskEmail(user.email),
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    }));
  }

  async create(dto: CreateAdminUserDto) {
    const email = dto.email.toLowerCase().trim();
    const role = await this.assertRoleExists(dto.role.toUpperCase());

    const existing = await this.prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException({ code: 'CONFLICT', message: 'This e-mail is already registered.' });
    }

    const user = await this.prisma.adminUser.create({
      data: {
        email,
        name: dto.name,
        role,
        passwordHash: await bcrypt.hash(dto.password, 12),
      },
    });
    return { id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive };
  }

  async update(id: string, dto: UpdateAdminUserDto, actorId: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found.' });
    }
    if (user.id === actorId && (dto.role !== undefined || dto.isActive === false)) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'You cannot change your own role or deactivate yourself.',
      });
    }

    const role = dto.role ? await this.assertRoleExists(dto.role.toUpperCase()) : undefined;

    const updated = await this.prisma.adminUser.update({
      where: { id },
      data: {
        name: dto.name,
        isActive: dto.isActive,
        ...(role ? { role } : {}),
        // Stamping the change retires tokens the old password already produced.
        ...(dto.password
          ? { passwordHash: await bcrypt.hash(dto.password, 12), passwordChangedAt: new Date() }
          : {}),
      },
    });
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      isActive: updated.isActive,
    };
  }
}
