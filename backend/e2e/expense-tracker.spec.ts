import { test, expect, Page, request as playwrightRequest } from '@playwright/test';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3002';

const USER_A = {
  name: 'E2E Alice',
  email: `e2e_alice_${Date.now()}@example.com`,
  password: 'alicepassword123',
};

const USER_B = {
  name: 'E2E Bob',
  email: `e2e_bob_${Date.now()}@example.com`,
  password: 'bobpassword123',
};

// ─── API Helpers (reset state via direct API calls, not UI) ───────────────────

async function apiRegister(user: typeof USER_A): Promise<string> {
  const ctx = await playwrightRequest.newContext();
  const res = await ctx.post(`${API_URL}/api/auth/register`, { data: user });
  const body = await res.json();
  await ctx.dispose();
  return body.token;
}

async function apiLogin(user: typeof USER_A): Promise<string> {
  const ctx = await playwrightRequest.newContext();
  const res = await ctx.post(`${API_URL}/api/auth/login`, {
    data: { email: user.email, password: user.password },
  });
  const body = await res.json();
  await ctx.dispose();
  return body.token;
}

async function apiDeleteAllExpenses(token: string): Promise<void> {
  const ctx = await playwrightRequest.newContext();
  const res = await ctx.get(`${API_URL}/api/expenses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const expenses: { id: number }[] = await res.json();
  for (const expense of expenses) {
    await ctx.delete(`${API_URL}/api/expenses/${expense.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  await ctx.dispose();
}

async function apiDeleteUser(token: string): Promise<void> {
  // If the API exposes a delete-account endpoint, call it here.
  // Otherwise expenses are cleaned up and the user stays (seeded users are acceptable).
  await apiDeleteAllExpenses(token);
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

async function uiRegister(page: Page, user: typeof USER_A): Promise<void> {
  await page.goto(`${BASE_URL}/register`);
  await page.getByLabel(/name/i).fill(user.name);
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole('button', { name: /register|sign up|create account/i }).click();
  await page.waitForURL(`${BASE_URL}/expenses`);
}

async function uiLogin(page: Page, user: typeof USER_A): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL(`${BASE_URL}/expenses`);
}

async function uiLogout(page: Page): Promise<void> {
  await page.getByRole('button', { name: /logout|sign out/i }).click();
  await page.waitForURL(`${BASE_URL}/login`);
}

// ═════════════════════════════════════════════════════════════════════════════
// JOURNEY 1: User Registration & Login
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Journey 1: User Registration and Login', () => {
  let token: string;

  test.beforeEach(async () => {
    // Ensure user does not exist before each test — state is reset via API
    try {
      token = await apiLogin(USER_A);
      await apiDeleteAllExpenses(token);
    } catch {
      // User doesn't exist yet, which is fine for register tests
    }
  });

  test.afterEach(async () => {
    try {
      token = await apiLogin(USER_A);
      await apiDeleteUser(token);
    } catch {
      // User may not have been created in this test
    }
  });

  test('user can register a new account and land on expenses page', async ({ page }) => {
    await page.goto(`${BASE_URL}/register`);

    await page.getByLabel(/name/i).fill(USER_A.name);
    await page.getByLabel(/email/i).fill(USER_A.email);
    await page.getByLabel(/password/i).fill(USER_A.password);
    await page.getByRole('button', { name: /register|sign up|create account/i }).click();

    await expect(page).toHaveURL(`${BASE_URL}/expenses`);
    await expect(page.getByText(/expenses|dashboard/i)).toBeVisible();
  });

  test('user sees an error when registering with an already used email', async ({ page }) => {
    // Pre-register via API so the email is already taken
    await apiRegister(USER_A);

    await page.goto(`${BASE_URL}/register`);
    await page.getByLabel(/name/i).fill(USER_A.name);
    await page.getByLabel(/email/i).fill(USER_A.email);
    await page.getByLabel(/password/i).fill(USER_A.password);
    await page.getByRole('button', { name: /register|sign up|create account/i }).click();

    await expect(page.getByText(/already|exists|taken|registered/i)).toBeVisible();
  });

  test('registered user can log in and is redirected to expenses', async ({ page }) => {
    await apiRegister(USER_A);

    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/email/i).fill(USER_A.email);
    await page.getByLabel(/password/i).fill(USER_A.password);
    await page.getByRole('button', { name: /login|sign in/i }).click();

    await expect(page).toHaveURL(`${BASE_URL}/expenses`);
  });

  test('user sees an error when logging in with wrong password', async ({ page }) => {
    await apiRegister(USER_A);

    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/email/i).fill(USER_A.email);
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /login|sign in/i }).click();

    await expect(page.getByText(/invalid|incorrect|unauthorized|wrong/i)).toBeVisible();
  });

  test('unauthenticated user is redirected to login when visiting expenses', async ({ page }) => {
    await page.goto(`${BASE_URL}/expenses`);
    await expect(page).toHaveURL(`${BASE_URL}/login`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// JOURNEY 2: Expense Management (Create, Read, Update, Delete)
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Journey 2: Expense Management (CRUD)', () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    // Register fresh user via API and wipe their expenses before each test
    token = await apiRegister(USER_A);
    await apiDeleteAllExpenses(token);

    // Log in through the UI so the session cookie/token is set in the browser
    await uiLogin(page, USER_A);
  });

  test.afterEach(async () => {
    await apiDeleteUser(token);
  });

  test('user can add a new expense and see it in the list', async ({ page }) => {
    await page.getByRole('button', { name: /add expense|new expense|\+/i }).click();

    await page.getByLabel(/name/i).fill('Team Lunch');
    await page.getByLabel(/amount/i).fill('47.80');
    await page.getByLabel(/date/i).fill('2026-02-04');
    await page.getByLabel(/category/i).selectOption('meals');

    await page.getByRole('button', { name: /save|add|submit/i }).click();

    await expect(page.getByText('Team Lunch')).toBeVisible();
    await expect(page.getByText(/47\.80|47\.8|\$47/)).toBeVisible();
  });

  test('user can edit an existing expense', async ({ page }) => {
    // Create expense via API so the test starts with known data
    const ctx = await playwrightRequest.newContext();
    await ctx.post(`${API_URL}/api/expenses`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Original Expense', amount: 20.0, category: 'bills', date: '2026-02-01' },
    });
    await ctx.dispose();

    await page.reload();

    await page.getByText('Original Expense')
      .locator('..')
      .getByRole('button', { name: /edit/i })
      .click();

    await page.getByLabel(/name/i).clear();
    await page.getByLabel(/name/i).fill('Updated Expense');
    await page.getByLabel(/amount/i).clear();
    await page.getByLabel(/amount/i).fill('35.00');

    await page.getByRole('button', { name: /save|update/i }).click();

    await expect(page.getByText('Updated Expense')).toBeVisible();
    await expect(page.getByText('Original Expense')).not.toBeVisible();
  });

  test('user can delete an expense and it disappears from the list', async ({ page }) => {
    const ctx = await playwrightRequest.newContext();
    await ctx.post(`${API_URL}/api/expenses`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Expense To Delete', amount: 15.0, category: 'transport', date: '2026-02-05' },
    });
    await ctx.dispose();

    await page.reload();

    await page.getByText('Expense To Delete')
      .locator('..')
      .getByRole('button', { name: /delete/i })
      .click();

    // Confirm deletion dialog if present
    const confirmButton = page.getByRole('button', { name: /confirm|yes|delete/i });
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    }

    await expect(page.getByText('Expense To Delete')).not.toBeVisible();
  });

  test('empty state is shown when user has no expenses', async ({ page }) => {
    await page.reload();
    await expect(page.getByText(/no expenses|nothing here|empty|add your first/i)).toBeVisible();
  });

  test('multiple expenses are all displayed in the list', async ({ page }) => {
    const ctx = await playwrightRequest.newContext();
    const expenses = [
      { name: 'Electric Bill', amount: 94.50, category: 'bills', date: '2026-02-01' },
      { name: 'Uber Ride', amount: 22.00, category: 'transport', date: '2026-02-03' },
      { name: 'Coffee', amount: 5.50, category: 'meals', date: '2026-02-06' },
    ];
    for (const expense of expenses) {
      await ctx.post(`${API_URL}/api/expenses`, {
        headers: { Authorization: `Bearer ${token}` },
        data: expense,
      });
    }
    await ctx.dispose();

    await page.reload();

    await expect(page.getByText('Electric Bill')).toBeVisible();
    await expect(page.getByText('Uber Ride')).toBeVisible();
    await expect(page.getByText('Coffee')).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// JOURNEY 3: Logout & Session Security
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Journey 3: Logout and Session Security', () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    token = await apiRegister(USER_A);
    await uiLogin(page, USER_A);
  });

  test.afterEach(async () => {
    await apiDeleteUser(token);
  });

  test('user can log out and is redirected to login page', async ({ page }) => {
    await uiLogout(page);
    await expect(page).toHaveURL(`${BASE_URL}/login`);
  });

  test('after logout, visiting expenses redirects back to login', async ({ page }) => {
    await uiLogout(page);
    await page.goto(`${BASE_URL}/expenses`);
    await expect(page).toHaveURL(`${BASE_URL}/login`);
  });

  test('session persists on page reload', async ({ page }) => {
    await page.reload();
    await expect(page).toHaveURL(`${BASE_URL}/expenses`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// JOURNEY 4: Multi-Tenancy — Data Isolation Between Two Users
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Journey 4: Multi-Tenancy Data Isolation', () => {
  let tokenA: string;
  let tokenB: string;

  test.beforeEach(async () => {
    // Register both users fresh and give each one a distinct expense
    tokenA = await apiRegister(USER_A);
    tokenB = await apiRegister(USER_B);
    await apiDeleteAllExpenses(tokenA);
    await apiDeleteAllExpenses(tokenB);

    const ctx = await playwrightRequest.newContext();
    await ctx.post(`${API_URL}/api/expenses`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { name: 'Alice Private Expense', amount: 100, category: 'bills', date: '2026-02-01' },
    });
    await ctx.post(`${API_URL}/api/expenses`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { name: 'Bob Private Expense', amount: 200, category: 'meals', date: '2026-02-01' },
    });
    await ctx.dispose();
  });

  test.afterEach(async () => {
    await apiDeleteUser(tokenA);
    await apiDeleteUser(tokenB);
  });

  test("User A cannot see User B's expenses in their list", async ({ page }) => {
    await uiLogin(page, USER_A);

    await expect(page.getByText('Alice Private Expense')).toBeVisible();
    await expect(page.getByText('Bob Private Expense')).not.toBeVisible();
  });

  test("User B cannot see User A's expenses in their list", async ({ page }) => {
    await uiLogin(page, USER_B);

    await expect(page.getByText('Bob Private Expense')).toBeVisible();
    await expect(page.getByText('Alice Private Expense')).not.toBeVisible();
  });

  test("User A's expenses are unaffected when User B adds an expense", async ({ page }) => {
    // User B adds a new expense
    const ctx = await playwrightRequest.newContext();
    await ctx.post(`${API_URL}/api/expenses`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { name: 'Bob Extra', amount: 50, category: 'transport', date: '2026-02-10' },
    });
    await ctx.dispose();

    // User A logs in and should only see their own expense
    await uiLogin(page, USER_A);
    await expect(page.getByText('Alice Private Expense')).toBeVisible();
    await expect(page.getByText('Bob Extra')).not.toBeVisible();
  });

  test("User A's expenses remain after User B deletes their own expense", async ({ page }) => {
    // User B deletes their own expense via API
    const ctx = await playwrightRequest.newContext();
    const listRes = await ctx.get(`${API_URL}/api/expenses`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const expenses: { id: number }[] = await listRes.json();
    for (const e of expenses) {
      await ctx.delete(`${API_URL}/api/expenses/${e.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
    }
    await ctx.dispose();

    // User A's data should be completely intact
    await uiLogin(page, USER_A);
    await expect(page.getByText('Alice Private Expense')).toBeVisible();
  });
});