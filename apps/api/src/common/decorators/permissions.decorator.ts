import { SetMetadata } from '@nestjs/common';
import { Permission } from '../constants';

export const PERMISSIONS_KEY = 'requiredPermissions';

/** The handler is only reachable when the caller holds ALL listed permissions. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
