/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import {
  checksumChar,
  encryptWithKey,
  hmacHash,
  maskValue,
  normalizeCharset,
  randomBody,
  resolveEncryptionKey,
} from '../src/common/crypto/crypto.util';
import { SUPER_ADMIN_ROLE, SYSTEM_ROLES } from '../src/common/constants';

dotenv.config();

const prisma = new PrismaClient();

const encryptionKey = resolveEncryptionKey(process.env.CODE_ENCRYPTION_KEY ?? '');
const hashSecret = process.env.CODE_HASH_SECRET ?? 'dev-code-hash-secret';
const checksumSecret = process.env.CODE_CHECKSUM_SECRET ?? 'dev-code-checksum-secret';

function makeCode(prefix: string, charset: string, length: number): string {
  const body = `${prefix}${randomBody(charset, length)}`;
  return `${body}${checksumChar(body, checksumSecret)}`;
}

async function seedRoles() {
  for (const role of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {
        description: role.description,
        permissions: JSON.stringify(role.permissions),
        isSystem: true,
      },
      create: {
        name: role.name,
        description: role.description,
        permissions: JSON.stringify(role.permissions),
        isSystem: true,
      },
    });
  }

  // Legacy installs used free-form role strings.
  const orphans = await prisma.adminUser.findMany({ select: { id: true, role: true } });
  const known = new Set(SYSTEM_ROLES.map((r) => r.name));
  for (const user of orphans) {
    if (!known.has(user.role)) {
      await prisma.adminUser.update({ where: { id: user.id }, data: { role: SUPER_ADMIN_ROLE } });
    }
  }

  console.log(`✔ ${SYSTEM_ROLES.length} system roles ready`);
}

async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash, isActive: true, role: SUPER_ADMIN_ROLE },
    create: { email, name: 'Platform Admin', passwordHash, role: SUPER_ADMIN_ROLE },
  });

  console.log(`✔ Admin user ready: ${email} / ${password}`);
}

async function seedCouponTypes() {
  const types = [
    {
      code: 'AMAZON10',
      name: 'Amazon ₹100 Gift Card',
      value: '₹100',
      description: 'Amazon gift voucher',
      lowStockThreshold: 10,
    },
    {
      code: 'COFFEE',
      name: 'Free Coffee',
      value: '1 cup',
      description: 'Redeemable at any outlet',
      lowStockThreshold: 10,
    },
  ];

  for (const type of types) {
    await prisma.couponType.upsert({
      where: { code: type.code },
      update: {},
      create: { ...type, isActive: true },
    });
  }
  console.log(`✔ ${types.length} coupon types ready`);
}

async function seedCoupons() {
  const charset = normalizeCharset();
  const inventory: { typeCode: string; count: number; value: string }[] = [
    { typeCode: 'AMAZON10', count: 25, value: '₹100' },
    { typeCode: 'COFFEE', count: 5, value: '1 cup' },
  ];

  for (const item of inventory) {
    const existing = await prisma.coupon.count({ where: { couponTypeCode: item.typeCode } });
    if (existing > 0) continue;

    const rows = Array.from({ length: item.count }, () => {
      const value = makeCode(`${item.typeCode.slice(0, 3)}-`, charset, 8);
      return {
        couponTypeCode: item.typeCode,
        couponCodeEncrypted: encryptWithKey(value, encryptionKey),
        couponCodeHash: hmacHash(value, hashSecret),
        value: item.value,
        status: 'AVAILABLE',
      };
    });

    await prisma.coupon.createMany({ data: rows });
    console.log(`✔ ${item.count} ${item.typeCode} coupons added to inventory`);
  }
}

async function seedSurvey() {
  const existing = await prisma.survey.findFirst({ where: { title: 'Product Experience Survey' } });
  if (existing) return existing;

  const questions = [
    {
      id: 'q1',
      type: 'nps',
      label: 'How likely are you to recommend us to a friend?',
      helpText: '0 = not likely, 10 = extremely likely',
      required: true,
      min: 0,
      max: 10,
    },
    {
      id: 'q2',
      type: 'single_choice',
      label: 'How often do you use our product?',
      required: true,
      options: [
        { value: 'daily', label: 'Daily' },
        { value: 'weekly', label: 'Weekly' },
        { value: 'monthly', label: 'Monthly' },
        { value: 'first_time', label: 'This is my first time' },
      ],
    },
    {
      id: 'q3',
      type: 'multi_choice',
      label: 'What did you like the most?',
      required: true,
      options: [
        { value: 'quality', label: 'Quality' },
        { value: 'price', label: 'Price' },
        { value: 'packaging', label: 'Packaging' },
        { value: 'support', label: 'Customer support' },
      ],
    },
    {
      id: 'q4',
      type: 'rating',
      label: 'Rate your overall experience',
      required: true,
      min: 1,
      max: 5,
    },
    {
      id: 'q5',
      type: 'textarea',
      label: 'Anything we can improve?',
      required: false,
      maxLength: 500,
    },
  ];

  const survey = await prisma.survey.create({
    data: {
      title: 'Product Experience Survey',
      description: 'Five quick questions - takes under a minute.',
      questions: JSON.stringify(questions),
      isActive: true,
    },
  });
  console.log('✔ Native survey created');
  return survey;
}

async function seedBatch(surveyId: string) {
  const existing = await prisma.batch.findFirst({ where: { name: 'Demo Launch Batch' } });
  if (existing) {
    console.log('• Demo batch already exists - skipping code generation');
    return;
  }

  const charset = normalizeCharset();
  const codeLength = 10;
  const quantity = 20;
  const prefix = 'DEMO';

  const batch = await prisma.batch.create({
    data: {
      name: 'Demo Launch Batch',
      description: 'Sample batch created by the seed script.',
      sku: 'DEMO-SKU-001',
      surveyType: 'NATIVE',
      surveyId,
      couponType: 'AMAZON10',
      prefix,
      charset,
      codeLength,
      quantity,
      status: 'ACTIVE',
    },
  });

  const codes = new Set<string>();
  while (codes.size < quantity) codes.add(makeCode(prefix, charset, codeLength));

  await prisma.code.createMany({
    data: Array.from(codes).map((value) => ({
      batchId: batch.id,
      codeHash: hmacHash(value, hashSecret),
      codeEncrypted: encryptWithKey(value, encryptionKey),
      codeMasked: maskValue(value),
      status: 'UNUSED',
    })),
  });

  const appUrl = (process.env.PUBLIC_APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  const sample = Array.from(codes).slice(0, 3);
  console.log(`✔ Demo batch with ${quantity} codes created. Try one of these URLs:`);
  sample.forEach((code) => console.log(`   ${appUrl}/read/${code}`));
}

async function main() {
  await seedRoles();
  await seedAdmin();
  await seedCouponTypes();
  await seedCoupons();
  const survey = await seedSurvey();
  await seedBatch(survey!.id);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
