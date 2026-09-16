/** Masks a secret so only its shape is visible: `AMZ-1234ABCD` -> `AMZ-••••ABCD`. */
export function maskSecret(value: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '••••';
  if (trimmed.length <= 4) return '•'.repeat(trimmed.length);
  const visible = Math.min(4, trimmed.length - 4);
  return `${'•'.repeat(trimmed.length - visible)}${trimmed.slice(-visible)}`;
}

/** `jane.doe@example.com` -> `j•••@example.com`. */
export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const [local, domain] = value.split('@');
  if (!domain) return maskSecret(value);
  const head = local.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(local.length - 1, 3))}@${domain}`;
}
