import type { BaseRecord, ExportBundleV3, RemoteTable } from '../domain/types';
import { db } from './db';
import { localTableByRemote, saveRecord } from './repository';

export async function exportUserData(userId: string): Promise<ExportBundleV3> {
  const active = <T extends BaseRecord>(rows: T[]) => rows.filter((row) => !row.deletedAt);
  const [profiles, days, meals, workouts, weights, foods, combos, supplements, checkins, plans] =
    await Promise.all([
      db.profiles.where('userId').equals(userId).toArray(),
      db.days.where('userId').equals(userId).toArray(),
      db.meals.where('userId').equals(userId).toArray(),
      db.workouts.where('userId').equals(userId).toArray(),
      db.weights.where('userId').equals(userId).toArray(),
      db.foods.where('userId').equals(userId).toArray(),
      db.combos.where('userId').equals(userId).toArray(),
      db.supplements.where('userId').equals(userId).toArray(),
      db.checkins.where('userId').equals(userId).toArray(),
      db.plans.where('userId').equals(userId).toArray(),
    ]);
  return {
    format: 'health-data-v3',
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    appVersion: '3.0.0',
    data: {
      profile: active(profiles)[0],
      days: active(days),
      meals: active(meals),
      workouts: active(workouts),
      weights: active(weights),
      foods: active(foods),
      combos: active(combos),
      supplements: active(supplements),
      checkins: active(checkins),
      plans: active(plans),
    },
  };
}

export function downloadExport(bundle: ExportBundleV3): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `health-data-v3-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importV3(bundle: ExportBundleV3, userId: string): Promise<number> {
  if (bundle.format !== 'health-data-v3' || bundle.schemaVersion !== 3) {
    throw new Error('不是有效的 health-data-v3 备份。');
  }
  const groups: Array<[RemoteTable, BaseRecord[]]> = [
    ['profiles', bundle.data.profile ? [bundle.data.profile] : []],
    ['days', bundle.data.days],
    ['meal_entries', bundle.data.meals],
    ['workouts', bundle.data.workouts],
    ['weight_entries', bundle.data.weights],
    ['foods', bundle.data.foods],
    ['combos', bundle.data.combos],
    ['supplement_definitions', bundle.data.supplements],
    ['supplement_checkins', bundle.data.checkins],
    ['training_plans', bundle.data.plans],
  ];
  let imported = 0;
  for (const [table, rows] of groups) {
    for (const row of rows) {
      const normalized = { ...row, userId };
      const existing = await localTableByRemote[table].get(normalized.id);
      if (!existing || normalized.version > existing.version) {
        await saveRecord(table, normalized);
        imported += 1;
      }
    }
  }
  return imported;
}
