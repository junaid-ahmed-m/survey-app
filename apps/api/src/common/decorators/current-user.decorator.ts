import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Permission } from '../constants';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  permissions: Permission[];
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
