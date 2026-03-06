import db from '../db/knex.js';
import type { Expense, ExpenseWithCategory } from '../types/index.js';

interface CreateExpenseParams {
  userId: number;
  categoryId: number;
  amount: number;
  description: string;
  date: string;
}

interface UpdateExpenseParams {
  categoryId?: number;
  amount?: number;
  description?: string;
  date?: string;
}

interface ListExpensesParams {
  userId: number;
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export async function listExpenses({
  userId,
  limit = 50,
  offset = 0,
  startDate,
  endDate,
  search,
}: ListExpensesParams): Promise<ExpenseWithCategory[]> {
  let query = db('expenses')
    .join('categories', 'expenses.categoryId', 'categories.id')
    .select(
      'expenses.*',
      'categories.name as categoryName',
      'categories.icon as categoryIcon'
    )
    .where('expenses.userId', userId)
    .orderBy('expenses.date', 'desc')
    .limit(limit)
    .offset(offset);

  if (startDate) {
    query = query.where('expenses.date', '>=', startDate);
  }
  if (endDate) {
    query = query.where('expenses.date', '<=', endDate);
  }
  if (search) {
    query = query.where('expenses.description', 'like', `%${search}%`);
  }

  return query;
}

export async function getExpense(id: number, userId: number): Promise<ExpenseWithCategory | null> {
  const expense = await db('expenses')
    .join('categories', 'expenses.categoryId', 'categories.id')
    .select(
      'expenses.*',
      'categories.name as categoryName',
      'categories.icon as categoryIcon'
    )
    .where('expenses.id', id)
    .where('expenses.userId', userId)
    .first();

  return expense || null;
}

export async function createExpense(params: CreateExpenseParams): Promise<Expense> {
  const [id] = await db('expenses').insert(params);
  const expense = await db('expenses').where({ id }).first<Expense>();
  return expense!;
}

export async function updateExpense(
  id: number,
  userId: number,
  params: UpdateExpenseParams
): Promise<Expense | null> {
  const existing = await db('expenses').where({ id, userId }).first();
  if (!existing) return null;

  await db('expenses').where({ id, userId }).update(params);
  const expense = await db('expenses').where({ id }).first<Expense>();
  return expense!;
}

export async function deleteExpense(id: number, userId: number): Promise<boolean> {
  const deleted = await db('expenses').where({ id, userId }).delete();
  return deleted > 0;
}

export async function getMonthlyTotal(userId: number, year: number, month: number): Promise<number> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`; 
  const endDate = new Date(year, month, 0).toISOString().split('T')[0];

  const result = await db('expenses')
    .where('userId', userId)
    .whereBetween('date', [startDate, endDate])
    .sum('amount as total')
    .first();

  return Number(result?.total) || 0;
}
