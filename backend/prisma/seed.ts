/**
 * Seeds subscription plans (always) and two demo companies (unless SEED_DEMO=false).
 * Runs as the database owner, so it is not restricted by Row-Level Security.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type PaymentMethod, type Role } from '../src/generated/prisma/client.js';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required for seeding');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const PLANS = [
  { id: 'free', name: 'Free', priceMonthly: 0, maxUsers: 3, maxInvoicesPerMonth: 20, sortOrder: 1,
    features: ['Up to 3 users', '20 invoices / month', 'Customer management', 'Basic analytics'] },
  { id: 'pro', name: 'Pro', priceMonthly: 4_900_00, maxUsers: 15, maxInvoicesPerMonth: null, sortOrder: 2,
    features: ['Up to 15 users', 'Unlimited invoices', 'Full analytics dashboard', 'Audit logs'] },
  { id: 'enterprise', name: 'Enterprise', priceMonthly: 14_900_00, maxUsers: 100, maxInvoicesPerMonth: null, sortOrder: 3,
    features: ['Up to 100 users', 'Unlimited invoices', 'Priority support', 'Audit log export'] },
];

const PASSWORD = 'Password123!';
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]) => arr[rand(0, arr.length - 1)];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

interface DemoCompany {
  name: string;
  slug: string;
  plan: string;
  users: { email: string; name: string; role: Role }[];
  customers: string[];
  products: [string, number][]; // description, unit price in rupees
}

const COMPANIES: DemoCompany[] = [
  {
    name: 'Lanka Traders (Pvt) Ltd',
    slug: 'lanka-traders',
    plan: 'pro',
    users: [
      { email: 'admin@lankatraders.lk', name: 'Nimal Perera', role: 'ADMIN' },
      { email: 'manager@demo.lk', name: 'Kasun Fernando', role: 'MANAGER' },
      { email: 'staff@lankatraders.lk', name: 'Dilini Silva', role: 'EMPLOYEE' },
    ],
    customers: ['Colombo Hardware Stores', 'Kandy Supermart', 'Galle Fort Hotel', 'Negombo Fisheries Co-op', 'Jaffna Textiles', 'Matara Builders'],
    products: [['Cement bags (50kg)', 2_650], ['Steel rods (12mm)', 4_200], ['Roofing sheets', 3_800], ['Paint (4L)', 6_500], ['Delivery charge', 3_000]],
  },
  {
    name: 'Ceylon Tech Solutions',
    slug: 'ceylon-tech',
    plan: 'free',
    users: [
      { email: 'admin@ceylontech.lk', name: 'Ayesha Jayawardena', role: 'ADMIN' },
      { email: 'manager@demo.lk', name: 'Kasun Fernando', role: 'EMPLOYEE' }, // same person, 2nd company
    ],
    customers: ['Dialog Retail Partner', 'Sunrise Pharmacy', 'Hill Country Tea Estates', 'Blue Ocean Resorts'],
    products: [['Website development', 150_000], ['Monthly hosting', 5_000], ['IT support (hour)', 3_500], ['Laptop repair', 12_000]],
  },
];

async function seedPlans() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({ where: { id: plan.id }, update: plan, create: plan });
  }
  console.log(`✔ ${PLANS.length} plans`);
}

async function seedCompany(c: DemoCompany, passwordHash: string) {
  if (await prisma.tenant.findUnique({ where: { slug: c.slug } })) {
    console.log(`• ${c.name} already exists — skipped`);
    return;
  }
  const tenant = await prisma.tenant.create({ data: { name: c.name, slug: c.slug, createdAt: daysAgo(240) } });
  await prisma.subscription.create({
    data: { tenantId: tenant.id, planId: c.plan, currentPeriodStart: daysAgo(10), currentPeriodEnd: addDays(new Date(), 20) },
  });

  const users = [];
  for (const u of c.users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, passwordHash },
    });
    await prisma.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: u.role, createdAt: daysAgo(230) } });
    users.push(user);
  }
  const admin = users[0];
  const log = (action: string, entityType: string, entityId: string, createdAt: Date, metadata?: object, actorId = admin.id) =>
    prisma.auditLog.create({ data: { tenantId: tenant.id, actorId, action, entityType, entityId, metadata, createdAt, ip: '127.0.0.1' } });

  await log('tenant.created', 'Tenant', tenant.id, daysAgo(240), { name: c.name });

  const customers = [];
  for (const name of c.customers) {
    const createdAt = daysAgo(rand(200, 230));
    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        name,
        email: `accounts@${name.toLowerCase().replace(/[^a-z]+/g, '')}.lk`,
        phone: `+94 7${rand(0, 8)} ${rand(100, 999)} ${rand(1000, 9999)}`,
        address: pick(['Colombo 03', 'Kandy', 'Galle', 'Negombo', 'Jaffna', 'Matara', 'Kurunegala']),
        createdAt,
      },
    });
    customers.push(customer);
    await log('customer.created', 'Customer', customer.id, createdAt, { name });
  }

  // ~8 months of invoices with realistic statuses
  let number = 1000;
  const methods: PaymentMethod[] = ['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'ONLINE'];
  for (let age = 220; age >= 0; age -= rand(4, 9)) {
    number += 1;
    const issueDate = daysAgo(age);
    const dueDate = addDays(issueDate, 30);
    const lines = Array.from({ length: rand(1, 3) }, () => {
      const [description, rupees] = pick(c.products);
      const quantity = rupees > 20_000 ? 1 : rand(1, 25);
      return { description, quantity, unitPrice: rupees * 100, amount: quantity * rupees * 100 };
    });
    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const taxRate = 18;
    const tax = Math.round((subtotal * taxRate) / 100);
    const total = subtotal + tax;

    // Older invoices are mostly paid; recent ones are open, partial or draft
    const roll = Math.random();
    let status: 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
    if (age < 5) status = 'DRAFT';
    else if (age > 45) status = roll < 0.85 ? 'PAID' : roll < 0.93 ? 'PARTIALLY_PAID' : roll < 0.97 ? 'SENT' : 'VOID';
    else status = roll < 0.45 ? 'PAID' : roll < 0.65 ? 'PARTIALLY_PAID' : 'SENT';

    const creator = pick(users);
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id, number, customerId: pick(customers).id, status, issueDate, dueDate, taxRate,
        subtotal, tax, total, createdById: creator.id, createdAt: issueDate,
        notes: 'Thank you for your business.',
        items: { create: lines.map((l) => ({ ...l, tenantId: tenant.id })) },
      },
    });
    await log('invoice.created', 'Invoice', invoice.id, issueDate, { number, total }, creator.id);
    if (status !== 'DRAFT') await log('invoice.sent', 'Invoice', invoice.id, addDays(issueDate, 0.1), { number }, creator.id);

    const paid = status === 'PAID' ? total : status === 'PARTIALLY_PAID' ? Math.round(total * (rand(30, 70) / 100)) : 0;
    if (paid > 0) {
      const paidAt = new Date(Math.min(addDays(issueDate, rand(3, 28)).getTime(), Date.now() - 3_600_000));
      const payment = await prisma.payment.create({
        data: { tenantId: tenant.id, invoiceId: invoice.id, amount: paid, method: pick(methods), paidAt, recordedById: admin.id, reference: `REF-${rand(10000, 99999)}` },
      });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaid: paid } });
      await log('payment.recorded', 'Invoice', invoice.id, paidAt, { paymentId: payment.id, number, amount: paid, method: payment.method });
    }
    if (status === 'VOID') await log('invoice.voided', 'Invoice', invoice.id, addDays(issueDate, 2), { number });
  }
  console.log(`✔ ${c.name}: ${users.length} users, ${customers.length} customers, ${number - 1000} invoices`);
}

async function main() {
  await seedPlans();
  if (process.env.SEED_DEMO === 'false') return;
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  for (const c of COMPANIES) await seedCompany(c, passwordHash);
  console.log(`\nDemo logins (password: ${PASSWORD})`);
  console.log('  admin@lankatraders.lk  — Admin, Lanka Traders (Pro plan)');
  console.log('  manager@demo.lk        — Manager at Lanka Traders + Employee at Ceylon Tech (company switcher)');
  console.log('  staff@lankatraders.lk  — Employee, Lanka Traders');
  console.log('  admin@ceylontech.lk    — Admin, Ceylon Tech (Free plan)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
