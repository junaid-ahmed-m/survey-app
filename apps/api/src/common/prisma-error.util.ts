import { Prisma } from '@prisma/client';

/** Postgres SQLSTATE for `unique_violation`. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Detects a unique-constraint violation, whatever shape Prisma reports it in:
 *  - `P2002` for the query builder (`meta.target` holds the field/index name),
 *  - `P2010` for `$queryRaw`, which wraps the driver error (`meta.code` = 23505).
 *
 * `field` narrows the check to one column so an unrelated constraint is not
 * silently swallowed.
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const meta = (error.meta ?? {}) as Record<string, unknown>;

  if (error.code === 'P2002') {
    if (!field) return true;
    const target = Array.isArray(meta.target) ? meta.target.join(',') : String(meta.target ?? '');
    return target.includes(field);
  }

  if (error.code === 'P2010' && String(meta.code ?? '') === PG_UNIQUE_VIOLATION) {
    if (!field) return true;
    return String(meta.message ?? '').includes(field);
  }

  return false;
}
