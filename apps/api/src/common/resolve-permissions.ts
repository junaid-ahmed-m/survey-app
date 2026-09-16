import { ALL_PERMISSIONS, Permission, SUPER_ADMIN_ROLE } from './constants';
import { PrismaService } from '../prisma/prisma.service';

/** Resolves the permission set of a role name. Unknown roles get nothing. */
export async function resolvePermissions(
  prisma: PrismaService,
  roleName: string,
): Promise<Permission[]> {
  if (roleName === SUPER_ADMIN_ROLE) return [...ALL_PERMISSIONS];

  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) return [];

  try {
    const parsed = JSON.parse(role.permissions) as string[];
    const known = new Set<string>(ALL_PERMISSIONS);
    return parsed.filter((permission): permission is Permission => known.has(permission));
  } catch {
    return [];
  }
}
