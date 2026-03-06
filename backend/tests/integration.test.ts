import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import db from '../src/db/knex';

// ─── Test Users ───────────────────────────────────────────────────────────────
// Two isolated users used throughout to verify SaaS data separation.

const USER_A = {
  name: 'Alice Test',
  email: 'integration_alice@example.com',
  password: 'alicepassword123',
};

const USER_B = {
  name: 'Bob Test',
  email: 'integration_bob@example.com',
  password: 'bobpassword123',
};

// ─── Shared Helpers ───────────────────────────────────────────────────────────

async function registerUser(user: typeof USER_A): Promise<string> {
  const res = await request(app).post('/api/auth/register').send(user);
  return res.body.token;
}

async function loginUser(user: typeof USER_A): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: user.password });
  return res.body.token;
}

async function createExpense(
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: number; [key: string]: unknown }> {
  const res = await request(app)
    .post('/api/expenses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Default Expense',
      amount: 50.0,
      category: 'meals',
      date: '2026-02-01',
      ...overrides,
    });
  return res.body;
}

async function deleteUserByEmail(email: string): Promise<void> {
  await db('users').where({ email }).delete();
}

async function deleteExpenseById(id: number): Promise<void> {
  await db('expenses').where({ id }).delete().catch(() => {});
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTH INTEGRATION TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Integration: POST /api/auth/register', () => {
  beforeEach(async () => {
    await deleteUserByEmail(USER_A.email);
  });

  afterEach(async () => {
    await deleteUserByEmail(USER_A.email);
  });

  it('registers a new user and returns a JWT token', async () => {
    const res = await request(app).post('/api/auth/register').send(USER_A);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it('returns 409 when registering with a duplicate email', async () => {
    await request(app).post('/api/auth/register').send(USER_A);
    const res = await request(app).post('/api/auth/register').send(USER_A);

    expect(res.status).toBe(409);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: USER_A.email, password: USER_A.password });

    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: USER_A.email, name: USER_A.name });

    expect(res.status).toBe(400);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: USER_A.name, password: USER_A.password });

    expect(res.status).toBe(400);
  });
});

describe('Integration: POST /api/auth/login', () => {
  beforeEach(async () => {
    await deleteUserByEmail(USER_A.email);
    await request(app).post('/api/auth/register').send(USER_A);
  });

  afterEach(async () => {
    await deleteUserByEmail(USER_A.email);
  });

  it('logs in with valid credentials and returns a JWT token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: USER_A.email, password: USER_A.password });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
  });

  it('returns 401 for an incorrect password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: USER_A.email, password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('returns 401 for a non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: USER_A.password });

    expect(res.status).toBe(401);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: USER_A.password });

    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: USER_A.email });

    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// EXPENSES INTEGRATION TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Integration: GET /api/expenses', () => {
  let tokenA: string;
  let expenseId: number;

  beforeEach(async () => {
    await deleteUserByEmail(USER_A.email);
    tokenA = await registerUser(USER_A);
    const expense = await createExpense(tokenA, { name: 'Grocery Run' });
    expenseId = expense.id;
  });

  afterEach(async () => {
    await deleteExpenseById(expenseId);
    await deleteUserByEmail(USER_A.email);
  });

  it('returns the authenticated user\'s expenses as an array', async () => {
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/expenses');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a malformed token', async () => {
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', 'Bearer not.a.valid.token');

    expect(res.status).toBe(401);
  });
});

describe('Integration: POST /api/expenses', () => {
  let tokenA: string;
  let createdId: number;

  beforeEach(async () => {
    await deleteUserByEmail(USER_A.email);
    tokenA = await registerUser(USER_A);
    createdId = 0;
  });

  afterEach(async () => {
    if (createdId) await deleteExpenseById(createdId);
    await deleteUserByEmail(USER_A.email);
  });

  it('creates an expense and returns it with an id', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Bus Pass', amount: 33.0, category: 'transport', date: '2026-02-10' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Bus Pass', amount: 33.0, category: 'transport' });
    expect(res.body).toHaveProperty('id');

    createdId = res.body.id;
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ amount: 20.0, category: 'bills', date: '2026-02-10' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when amount is missing', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Water Bill', category: 'bills', date: '2026-02-10' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when amount is not a number', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Water Bill', amount: 'free', category: 'bills', date: '2026-02-10' });

    expect(res.status).toBe(400);
  });

  it('returns 401 with no token', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .send({ name: 'Bus Pass', amount: 33.0, category: 'transport', date: '2026-02-10' });

    expect(res.status).toBe(401);
  });
});

describe('Integration: PUT /api/expenses/:id', () => {
  let tokenA: string;
  let expenseId: number;

  beforeEach(async () => {
    await deleteUserByEmail(USER_A.email);
    tokenA = await registerUser(USER_A);
    const expense = await createExpense(tokenA, { name: 'Original Name', amount: 10.0 });
    expenseId = expense.id;
  });

  afterEach(async () => {
    await deleteExpenseById(expenseId);
    await deleteUserByEmail(USER_A.email);
  });

  it('updates an expense and returns the updated record', async () => {
    const res = await request(app)
      .put(`/api/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Updated Name', amount: 99.99, category: 'bills', date: '2026-02-15' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Updated Name', amount: 99.99 });
  });

  it('returns 404 for a non-existent expense id', async () => {
    const res = await request(app)
      .put('/api/expenses/999999')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Ghost', amount: 5.0, category: 'meals', date: '2026-02-15' });

    expect(res.status).toBe(404);
  });

  it('returns 401 with no token', async () => {
    const res = await request(app)
      .put(`/api/expenses/${expenseId}`)
      .send({ name: 'No Auth', amount: 5.0, category: 'meals', date: '2026-02-15' });

    expect(res.status).toBe(401);
  });
});

describe('Integration: DELETE /api/expenses/:id', () => {
  let tokenA: string;
  let expenseId: number;

  beforeEach(async () => {
    await deleteUserByEmail(USER_A.email);
    tokenA = await registerUser(USER_A);
    const expense = await createExpense(tokenA, { name: 'To Be Deleted' });
    expenseId = expense.id;
  });

  afterEach(async () => {
    await deleteExpenseById(expenseId);
    await deleteUserByEmail(USER_A.email);
  });

  it('deletes an expense and confirms it no longer exists', async () => {
    const deleteRes = await request(app)
      .delete(`/api/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(deleteRes.status).toBe(200);

    // Verify it's truly gone
    const listRes = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`);

    const ids = listRes.body.map((e: { id: number }) => e.id);
    expect(ids).not.toContain(expenseId);
  });

  it('returns 404 when deleting a non-existent expense', async () => {
    const res = await request(app)
      .delete('/api/expenses/999999')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).delete(`/api/expenses/${expenseId}`);
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CATEGORIES INTEGRATION TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Integration: GET /api/categories', () => {
  let tokenA: string;

  beforeEach(async () => {
    await deleteUserByEmail(USER_A.email);
    tokenA = await registerUser(USER_A);
  });

  afterEach(async () => {
    await deleteUserByEmail(USER_A.email);
  });

  it('returns a non-empty list of categories', async () => {
    const res = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('includes bills, transport, and meals categories', async () => {
    const res = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${tokenA}`);

    const names: string[] = res.body.map((c: { name: string }) => c.name.toLowerCase());
    expect(names).toContain('bills');
    expect(names).toContain('transport');
    expect(names).toContain('meals');
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-TENANCY: DATA SEPARATION BETWEEN TWO USERS
// ═════════════════════════════════════════════════════════════════════════════

describe('Integration: Multi-tenancy — data separation between users', () => {
  let tokenA: string;
  let tokenB: string;
  let expenseIdA: number;
  let expenseIdB: number;

  // Register both users fresh and create one expense each before every test.
  beforeEach(async () => {
    await deleteUserByEmail(USER_A.email);
    await deleteUserByEmail(USER_B.email);

    tokenA = await registerUser(USER_A);
    tokenB = await registerUser(USER_B);

    const expA = await createExpense(tokenA, { name: 'Alice Expense', amount: 100 });
    const expB = await createExpense(tokenB, { name: 'Bob Expense', amount: 200 });

    expenseIdA = expA.id;
    expenseIdB = expB.id;
  });

  afterEach(async () => {
    await deleteExpenseById(expenseIdA);
    await deleteExpenseById(expenseIdB);
    await deleteUserByEmail(USER_A.email);
    await deleteUserByEmail(USER_B.email);
  });

  it("User A's expense list does not contain User B's expenses", async () => {
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((e: { id: number }) => e.id);
    expect(ids).toContain(expenseIdA);
    expect(ids).not.toContain(expenseIdB);
  });

  it("User B's expense list does not contain User A's expenses", async () => {
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((e: { id: number }) => e.id);
    expect(ids).toContain(expenseIdB);
    expect(ids).not.toContain(expenseIdA);
  });

  it('User B cannot update an expense that belongs to User A', async () => {
    const res = await request(app)
      .put(`/api/expenses/${expenseIdA}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Hacked', amount: 1, category: 'meals', date: '2026-02-01' });

    expect(res.status).toBeOneOf([403, 404]);
  });

  it('User B cannot delete an expense that belongs to User A', async () => {
    const res = await request(app)
      .delete(`/api/expenses/${expenseIdA}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBeOneOf([403, 404]);
  });

  it('User A cannot read an expense that belongs to User B via direct id', async () => {
    // Attempt to fetch the specific expense directly if the API supports it
    const res = await request(app)
      .get(`/api/expenses/${expenseIdB}`)
      .set('Authorization', `Bearer ${tokenA}`);

    // Either the route doesn't exist (404) or access is denied (403)
    expect(res.status).toBeOneOf([403, 404]);
  });

  it('both users can independently create expenses without collision', async () => {
    const resA = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Alice Extra', amount: 15, category: 'transport', date: '2026-02-20' });

    const resB = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Bob Extra', amount: 25, category: 'bills', date: '2026-02-20' });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body.id).not.toBe(resB.body.id);

    // Clean up extras
    await deleteExpenseById(resA.body.id);
    await deleteExpenseById(resB.body.id);
  });

  it('deleting User A\'s expense does not affect User B\'s expense list', async () => {
    await request(app)
      .delete(`/api/expenses/${expenseIdA}`)
      .set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${tokenB}`);

    const ids = res.body.map((e: { id: number }) => e.id);
    expect(ids).toContain(expenseIdB);
  });
});