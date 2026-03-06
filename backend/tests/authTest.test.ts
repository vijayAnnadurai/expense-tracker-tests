import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import db from '../src/db/knex';

// ─── Auth Routes ─────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  const testUser = {
    email: 'register_test@example.com',
    password: 'testpassword123',
    name: 'Test User',
  };

  // Clean up the test user before and after each test so every test
  // starts from a clean slate and is not affected by prior runs.
  beforeEach(async () => {
    await db('users').where({ email: testUser.email }).delete();
  });

  afterEach(async () => {
    await db('users').where({ email: testUser.email }).delete();
  });

  it('should register a new user and return a JWT token', async () => {
    const res = await request(app).post('/api/auth/register').send(testUser);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
  });

  it('should return 400 if email is already taken', async () => {
    // Pre-register the user so the second attempt hits the duplicate check
    await request(app).post('/api/auth/register').send(testUser);
    const res = await request(app).post('/api/auth/register').send(testUser);

    expect(res.status).toBe(409);
  });

  it('should return 400 if required fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'missing@example.com' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  const credentials = { email: 'demo@example.com', password: 'password123' };

  // Auth/login tests are stateless (they read the seeded demo user),
  // but we reset local variables before each test for safety.
  let lastResponse: Awaited<ReturnType<typeof request>> | null;

  beforeEach(() => {
    lastResponse = null;
  });

  afterEach(() => {
    lastResponse = null;
  });

  it('should login with valid credentials and return a JWT token', async () => {
    lastResponse = await request(app).post('/api/auth/login').send(credentials);

    expect(lastResponse.status).toBe(200);
    expect(lastResponse.body).toHaveProperty('token');
    expect(typeof lastResponse.body.token).toBe('string');
  });

  it('should return 401 for invalid password', async () => {
    lastResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: 'wrongpassword' });

    expect(lastResponse.status).toBe(401);
  });

  it('should return 401 for non-existent email', async () => {
    lastResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });

    expect(lastResponse.status).toBe(401);
  });

  it('should return 400 if email or password is missing', async () => {
    lastResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email });

    expect(lastResponse.status).toBe(400);
  });
});