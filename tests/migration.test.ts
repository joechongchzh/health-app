import { describe, expect, it } from 'vitest';
import { db } from '../src/data/db';
import { importLegacyJson, previewLegacyMigration } from '../src/data/migration';

describe('旧版迁移预览', () => {
  it('准确统计旧版细粒度记录', () => {
    localStorage.setItem(
      'ht_data_v1',
      JSON.stringify({
        days: {
          '2026-08-14': {
            meals: { breakfast: [{ name: '鸡蛋' }], lunch: [{ name: '米饭' }, { name: '鸡胸' }] },
            workouts: [{ kind: 'strength' }],
          },
        },
        weights: [{ d: '2026-08-14', kg: 80 }],
        foods: [{ name: '鸡蛋' }],
        combos: [{ name: '套餐' }],
        suppDefs: [{ id: 'fish', name: '鱼油' }],
        split: [{ key: 'push', name: '推', ex: ['卧推'] }],
      }),
    );
    expect(previewLegacyMigration()).toEqual({
      exists: true,
      counts: {
        days: 1,
        meals: 3,
        workouts: 1,
        weights: 1,
        foods: 1,
        combos: 1,
        supplements: 1,
        checkins: 0,
        plans: 1,
      },
    });
  });

  it('无旧数据时安全返回', () => {
    expect(previewLegacyMigration().exists).toBe(false);
  });

  it('可直接导入旧 health-data 且重复导入不增加记录', async () => {
    const legacy = {
      days: {
        '2026-08-14': {
          meals: { dinner: [{ name: '测试晚餐', c: 20, p: 30, f: 10 }] },
          workouts: [],
        },
      },
    };
    const userId = '33333333-3333-4333-8333-333333333333';
    await importLegacyJson(legacy, userId);
    await importLegacyJson(legacy, userId);
    expect(await db.meals.where('userId').equals(userId).count()).toBe(1);
  });
});
