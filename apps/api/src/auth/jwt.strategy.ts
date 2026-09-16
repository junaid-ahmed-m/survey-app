import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { resolvePermissions } from '../common/resolve-permissions';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret') as string,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Session is no longer valid.' });
    }
    // A password change retires every token minted before it. `iat` only has
    // second precision, so allow a second of slack to avoid logging out the
    // session that performed the change.
    if (
      user.passwordChangedAt &&
      payload.iat !== undefined &&
      payload.iat * 1000 < user.passwordChangedAt.getTime() - 1000
    ) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Your password changed. Please sign in again.',
      });
    }
    // Resolved per request so a role change takes effect without a new token.
    const permissions = await resolvePermissions(this.prisma, user.role);
    return { id: user.id, email: user.email, name: user.name, role: user.role, permissions };
  }
}
