import Dexie, { type EntityTable } from 'dexie';
import type {
  Combo,
  DayRecord,
  Food,
  LocalAiSecrets,
  MealEntry,
  OutboxItem,
  Profile,
  SupplementCheckin,
  SupplementDefinition,
  TrainingPlan,
  WeightEntry,
  Workout,
} from '../domain/types';

export interface LocalMeta {
  key: string;
  value: unknown;
}

export interface LocalSecretRecord {
  key: 'ai';
  value: LocalAiSecrets;
}

class HealthDatabase extends Dexie {
  profiles!: EntityTable<Profile, 'id'>;
  days!: EntityTable<DayRecord, 'id'>;
  meals!: EntityTable<MealEntry, 'id'>;
  workouts!: EntityTable<Workout, 'id'>;
  weights!: EntityTable<WeightEntry, 'id'>;
  foods!: EntityTable<Food, 'id'>;
  combos!: EntityTable<Combo, 'id'>;
  supplements!: EntityTable<SupplementDefinition, 'id'>;
  checkins!: EntityTable<SupplementCheckin, 'id'>;
  plans!: EntityTable<TrainingPlan, 'id'>;
  outbox!: EntityTable<OutboxItem, 'id'>;
  meta!: EntityTable<LocalMeta, 'key'>;
  secrets!: EntityTable<LocalSecretRecord, 'key'>;

  constructor() {
    super('health-app-v3');
    this.version(1).stores({
      profiles: 'id, userId, updatedAt',
      days: 'id, userId, [userId+date], updatedAt, deletedAt',
      meals: 'id, userId, [userId+date], [userId+meal], updatedAt, deletedAt',
      workouts: 'id, userId, [userId+date], updatedAt, deletedAt',
      weights: 'id, userId, [userId+date], updatedAt, deletedAt',
      foods: 'id, userId, [userId+name], updatedAt, deletedAt',
      combos: 'id, userId, [userId+name], updatedAt, deletedAt',
      supplements: 'id, userId, updatedAt, deletedAt',
      checkins: 'id, userId, [userId+date], supplementId, updatedAt, deletedAt',
      plans: 'id, userId, updatedAt, deletedAt',
      outbox: 'id, userId, table, recordId, createdAt',
      meta: 'key',
      secrets: 'key',
    });
  }
}

export const db = new HealthDatabase();

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function getAiSecrets(): Promise<LocalAiSecrets> {
  return (await db.secrets.get('ai'))?.value ?? {};
}

export async function setAiSecrets(value: LocalAiSecrets): Promise<void> {
  await db.secrets.put({ key: 'ai', value });
}

export async function clearAiSecrets(): Promise<void> {
  await db.secrets.delete('ai');
}

export async function clearUserLocalData(userId: string): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.profiles,
      db.days,
      db.meals,
      db.workouts,
      db.weights,
      db.foods,
      db.combos,
      db.supplements,
      db.checkins,
      db.plans,
      db.outbox,
    ],
    async () => {
      await Promise.all([
        db.profiles.where('userId').equals(userId).delete(),
        db.days.where('userId').equals(userId).delete(),
        db.meals.where('userId').equals(userId).delete(),
        db.workouts.where('userId').equals(userId).delete(),
        db.weights.where('userId').equals(userId).delete(),
        db.foods.where('userId').equals(userId).delete(),
        db.combos.where('userId').equals(userId).delete(),
        db.supplements.where('userId').equals(userId).delete(),
        db.checkins.where('userId').equals(userId).delete(),
        db.plans.where('userId').equals(userId).delete(),
        db.outbox.where('userId').equals(userId).delete(),
      ]);
    },
  );
}
