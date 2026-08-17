import type { EntityTable } from 'dexie';
import type { BaseRecord, OutboxItem, RemoteTable } from '../domain/types';
import { db, newId, nowIso } from './db';

export const localTableByRemote: Record<RemoteTable, EntityTable<BaseRecord, 'id'>> = {
  profiles: db.profiles,
  days: db.days,
  meal_entries: db.meals,
  workouts: db.workouts,
  weight_entries: db.weights,
  foods: db.foods,
  combos: db.combos,
  supplement_definitions: db.supplements,
  supplement_checkins: db.checkins,
  training_plans: db.plans,
};

export function createRecord<T extends BaseRecord>(userId: string, values: Omit<T, keyof BaseRecord>): T {
  const timestamp = nowIso();
  return {
    ...values,
    id: newId(),
    userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
  } as T;
}

export async function saveRecord<T extends BaseRecord>(
  table: RemoteTable,
  record: T,
  queue = true,
): Promise<void> {
  const localTable = localTableByRemote[table];
  await db.transaction('rw', localTable, db.outbox, async () => {
    await localTable.put(record);
    if (queue) {
      const prior = await db.outbox.where('recordId').equals(record.id).first();
      const item: OutboxItem = {
        id: prior?.id ?? newId(),
        userId: record.userId,
        table,
        recordId: record.id,
        operation: record.deletedAt ? 'delete' : 'upsert',
        payload: record,
        createdAt: prior?.createdAt ?? nowIso(),
        attempts: 0,
      };
      await db.outbox.put(item);
    }
  });
}

export async function updateRecord<T extends BaseRecord>(
  table: RemoteTable,
  current: T,
  values: Partial<Omit<T, keyof BaseRecord>>,
): Promise<T> {
  const next = {
    ...current,
    ...values,
    updatedAt: nowIso(),
    version: current.version + 1,
  };
  await saveRecord(table, next);
  return next;
}

export async function softDeleteRecord<T extends BaseRecord>(table: RemoteTable, current: T): Promise<void> {
  const timestamp = nowIso();
  await saveRecord(table, {
    ...current,
    deletedAt: timestamp,
    updatedAt: timestamp,
    version: current.version + 1,
  });
}
