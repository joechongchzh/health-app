import type { BaseRecord, RemoteTable, SyncState } from '../domain/types';
import { db, nowIso } from '../data/db';
import { localTableByRemote } from '../data/repository';
import { requireSupabase } from './supabase';

interface RemoteRow {
  id: string;
  user_id: string;
  version: number;
  updated_at: string;
  deleted_at: string | null;
  payload: BaseRecord;
}

export interface SyncResult {
  state: SyncState;
  pushed: number;
  pulled: number;
  conflicts: number;
  message: string;
}

const remoteTables: RemoteTable[] = [
  'profiles',
  'days',
  'meal_entries',
  'workouts',
  'weight_entries',
  'foods',
  'combos',
  'supplement_definitions',
  'supplement_checkins',
  'training_plans',
];

function toRemote(record: BaseRecord) {
  return {
    id: record.id,
    user_id: record.userId,
    version: record.version,
    updated_at: record.updatedAt,
    deleted_at: record.deletedAt ?? null,
    payload: record,
  };
}

export async function syncUser(userId: string): Promise<SyncResult> {
  if (!navigator.onLine) {
    return { state: 'offline', pushed: 0, pulled: 0, conflicts: 0, message: '离线待同步' };
  }

  const client = requireSupabase();
  let pushed = 0;
  let pulled = 0;
  let conflicts = 0;

  const queue = await db.outbox.where('userId').equals(userId).sortBy('createdAt');
  for (const item of queue) {
    const { data: remote, error: readError } = await client
      .from(item.table)
      .select('id,user_id,version,updated_at,deleted_at,payload')
      .eq('id', item.recordId)
      .maybeSingle<RemoteRow>();
    if (readError) throw readError;

    if (remote && remote.version >= item.payload.version) {
      await localTableByRemote[item.table].put(remote.payload);
      await db.outbox.delete(item.id);
      conflicts += 1;
      continue;
    }

    const { error } = await client.from(item.table).upsert(toRemote(item.payload));
    if (error) {
      const { data: latest } = await client
        .from(item.table)
        .select('id,user_id,version,updated_at,deleted_at,payload')
        .eq('id', item.recordId)
        .maybeSingle<RemoteRow>();
      if (latest && latest.version >= item.payload.version) {
        await localTableByRemote[item.table].put(latest.payload);
        await db.outbox.delete(item.id);
        conflicts += 1;
        continue;
      }
      await db.outbox.update(item.id, {
        attempts: item.attempts + 1,
        lastError: error.message,
      });
      throw error;
    }
    await db.outbox.delete(item.id);
    pushed += 1;
  }

  for (const table of remoteTables) {
    const { data, error } = await client
      .from(table)
      .select('id,user_id,version,updated_at,deleted_at,payload')
      .eq('user_id', userId);
    if (error) throw error;

    for (const remote of (data ?? []) as RemoteRow[]) {
      const local = await localTableByRemote[table].get(remote.id);
      if (!local || remote.version > local.version) {
        await localTableByRemote[table].put(remote.payload);
        pulled += 1;
      }
    }
  }

  await db.meta.put({ key: `lastSync:${userId}`, value: nowIso() });
  const state: SyncState = conflicts > 0 ? 'conflict' : 'synced';
  return {
    state,
    pushed,
    pulled,
    conflicts,
    message: conflicts > 0 ? `已同步，${conflicts} 条采用云端较新版本` : '已同步',
  };
}
