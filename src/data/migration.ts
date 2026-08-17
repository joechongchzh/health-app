import type {
  Combo,
  DayRecord,
  Food,
  MealEntry,
  MealType,
  SupplementCheckin,
  SupplementDefinition,
  SupplementTime,
  TrainingPlan,
  WeightEntry,
  Workout,
} from '../domain/types';
import { db, newId, nowIso } from './db';
import { createRecord, saveRecord } from './repository';

const LEGACY_KEY = 'ht_data_v1';

interface LegacyDay {
  type?: string;
  trainTime?: string;
  meals?: Partial<Record<MealType, LegacyMeal[]>>;
  workouts?: LegacyWorkout[];
  supps?: Record<string, boolean | Record<string, boolean>>;
  updatedAt?: number;
}

interface LegacyMeal {
  id?: string;
  name?: string;
  amt?: string;
  c?: number;
  p?: number;
  f?: number;
  estimated?: boolean;
}

interface LegacyWorkout {
  id?: string;
  kind?: string;
  name?: string;
  mins?: number;
  duration?: number;
  kcal?: number;
  entries?: Array<{
    name?: string;
    exercise?: string;
    kg?: number;
    reps?: number;
    sets?: number;
  }>;
}

interface LegacyData {
  profile?: {
    height?: number;
    birth?: string;
    weight?: number;
    bodyfat?: number | null;
    activity?: number;
    gender?: string;
    goal?: string;
  };
  days?: Record<string, LegacyDay>;
  weights?: Array<{ d?: string; date?: string; kg?: number }>;
  foods?: Array<Record<string, unknown>>;
  combos?: Array<Record<string, unknown>>;
  suppDefs?: Array<Record<string, unknown>>;
  split?: Array<{ key?: string; name?: string; ex?: string[] }>;
}

export interface MigrationCounts {
  days: number;
  meals: number;
  workouts: number;
  weights: number;
  foods: number;
  combos: number;
  supplements: number;
  checkins: number;
  plans: number;
}

export interface LegacyPreview {
  exists: boolean;
  counts: MigrationCounts;
}

const zeroCounts = (): MigrationCounts => ({
  days: 0,
  meals: 0,
  workouts: 0,
  weights: 0,
  foods: 0,
  combos: 0,
  supplements: 0,
  checkins: 0,
  plans: 0,
});

function readLegacy(): LegacyData | null {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LegacyData;
  } catch {
    throw new Error('检测到旧数据，但内容已损坏。请先保留浏览器数据并联系维护者。');
  }
}

export function previewLegacyMigration(): LegacyPreview {
  const legacy = readLegacy();
  if (!legacy) return { exists: false, counts: zeroCounts() };
  const counts = zeroCounts();
  counts.days = Object.keys(legacy.days ?? {}).length;
  for (const day of Object.values(legacy.days ?? {})) {
    counts.meals += Object.values(day.meals ?? {}).reduce((sum, entries) => sum + (entries?.length ?? 0), 0);
    counts.workouts += day.workouts?.length ?? 0;
  }
  counts.weights = legacy.weights?.length ?? 0;
  counts.foods = legacy.foods?.length ?? 0;
  counts.combos = legacy.combos?.length ?? 0;
  counts.supplements = legacy.suppDefs?.length ?? 0;
  counts.checkins = Object.values(legacy.days ?? {}).reduce(
    (sum, day) => sum + Object.values(day.supps ?? {}).filter(Boolean).length,
    0,
  );
  counts.plans = legacy.split?.length ? 1 : 0;
  return { exists: true, counts };
}

export function getLegacyProfileDefaults(): Partial<{
  gender: 'male' | 'female';
  birthDate: string;
  heightCm: string;
  weightKg: string;
  bodyFatPct: string;
  activityFactor: string;
  goal: 'cut' | 'recomp' | 'bulk';
}> {
  const profile = readLegacy()?.profile;
  if (!profile) return {};
  const goal = ['cut', 'recomp', 'bulk'].includes(profile.goal ?? '')
    ? (profile.goal as 'cut' | 'recomp' | 'bulk')
    : 'cut';
  return {
    gender: profile.gender === 'f' ? 'female' : 'male',
    birthDate: profile.birth ?? '',
    heightCm: profile.height ? String(profile.height) : '',
    weightKg: profile.weight ? String(profile.weight) : '',
    bodyFatPct: profile.bodyfat ? String(profile.bodyfat) : '',
    activityFactor: profile.activity ? String(profile.activity) : '1.3',
    goal,
  };
}

function legacyStableId(userId: string, kind: string, parts: Array<string | number>): string {
  const input = `${userId}:${kind}:${parts.join(':')}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `00000000-0000-4000-8000-${hex.padStart(12, '0')}`;
}

function legacyTimestamp(value?: number): string {
  return value ? new Date(value).toISOString() : nowIso();
}

function num(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function supplementTime(value: string): SupplementTime {
  const values: Record<string, SupplementTime> = {
    早: 'morning',
    午: 'noon',
    晚: 'evening',
    练后: 'post_training',
    morning: 'morning',
    noon: 'noon',
    evening: 'evening',
    post_training: 'post_training',
  };
  return values[value] ?? 'morning';
}

export function createLegacyBackup(): string | null {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  const blob = new Blob([raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `health-data-v2-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  return raw;
}

export async function migrateLegacy(userId: string): Promise<MigrationCounts> {
  const legacy = readLegacy();
  if (!legacy) return zeroCounts();
  const marker = await db.meta.get(`legacyMigrated:${userId}`);
  if (marker) return marker.value as MigrationCounts;

  return migrateLegacyData(userId, legacy, true);
}

export async function importLegacyJson(value: unknown, userId: string): Promise<MigrationCounts> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('不是有效的旧版 health-data 备份。');
  }
  const legacy = value as LegacyData;
  if (!legacy.days && !legacy.weights && !legacy.foods && !legacy.profile) {
    throw new Error('旧版备份中没有可识别的健康数据。');
  }
  return migrateLegacyData(userId, legacy, false);
}

async function migrateLegacyData(
  userId: string,
  legacy: LegacyData,
  setMigrationMarker: boolean,
): Promise<MigrationCounts> {
  const counts = zeroCounts();
  for (const [date, day] of Object.entries(legacy.days ?? {})) {
    const updatedAt = legacyTimestamp(day.updatedAt);
    const dayRecord: DayRecord = {
      id: legacyStableId(userId, 'day', [date]),
      userId,
      createdAt: updatedAt,
      updatedAt,
      version: 1,
      date,
      type: day.type === 'train' ? 'strength' : day.type === 'cardio' ? 'cardio' : 'rest',
      trainingTime: day.trainTime === 'morning' ? 'morning' : 'evening',
    };
    await saveRecord('days', dayRecord);
    counts.days += 1;

    for (const [meal, entries] of Object.entries(day.meals ?? {})) {
      for (const [index, entry] of (entries ?? []).entries()) {
        const record: MealEntry = {
          id: legacyStableId(userId, 'meal', [date, meal, entry.id ?? index]),
          userId,
          createdAt: updatedAt,
          updatedAt,
          version: 1,
          date,
          meal: meal as MealType,
          name: entry.name || '未命名食物',
          amount: entry.amt || '1 份',
          carbs: num(entry.c),
          protein: num(entry.p),
          fat: num(entry.f),
          estimated: entry.estimated ?? true,
        };
        await saveRecord('meal_entries', record);
        counts.meals += 1;
      }
    }

    for (const [index, workout] of (day.workouts ?? []).entries()) {
      const record: Workout = {
        id: legacyStableId(userId, 'workout', [date, workout.id ?? index]),
        userId,
        createdAt: updatedAt,
        updatedAt,
        version: 1,
        date,
        kind: workout.kind === 'cardio' ? 'cardio' : 'strength',
        name: workout.name || (workout.kind === 'cardio' ? '有氧训练' : '力量训练'),
        durationMin: num(workout.mins ?? workout.duration),
        calories: num(workout.kcal),
        strengthEntries: workout.entries?.map((entry) => ({
          exercise: entry.exercise || entry.name || '未命名动作',
          weightKg: num(entry.kg),
          reps: num(entry.reps),
          sets: num(entry.sets) || 1,
        })),
      };
      await saveRecord('workouts', record);
      counts.workouts += 1;
    }
  }

  for (const [index, weight] of (legacy.weights ?? []).entries()) {
    const date = weight.d ?? weight.date;
    if (!date || !num(weight.kg)) continue;
    const record = createRecord<WeightEntry>(userId, {
      date,
      weightKg: num(weight.kg),
    });
    record.id = legacyStableId(userId, 'weight', [date, index]);
    await saveRecord('weight_entries', record);
    counts.weights += 1;
  }

  for (const [index, food] of (legacy.foods ?? []).entries()) {
    const name = str(food.name);
    if (!name) continue;
    const record = createRecord<Food>(userId, {
      name,
      category: str(food.cat, '自建'),
      servingLabel: str(food.serv ?? food.unit, '1 份'),
      servingGrams: num(food.servG) || undefined,
      carbs: num(food.c),
      protein: num(food.p),
      fat: num(food.f),
      source: str(food.source) || undefined,
      estimated: !food.source,
      uses: num(food.uses),
    });
    record.id = legacyStableId(userId, 'food', [name, index]);
    await saveRecord('foods', record);
    counts.foods += 1;
  }

  for (const [index, combo] of (legacy.combos ?? []).entries()) {
    const name = str(combo.name, `旧套餐 ${index + 1}`);
    const items = Array.isArray(combo.items) ? combo.items : [];
    const record = createRecord<Combo>(userId, {
      name,
      items: items.map((item) => {
        const value = item as Record<string, unknown>;
        return {
          name: str(value.name, '未命名食物'),
          amount: str(value.amt ?? value.amount, '1 份'),
          carbs: num(value.c ?? value.carbs),
          protein: num(value.p ?? value.protein),
          fat: num(value.f ?? value.fat),
        };
      }),
      uses: num(combo.uses),
    });
    record.id = legacyStableId(userId, 'combo', [name, index]);
    await saveRecord('combos', record);
    counts.combos += 1;
  }

  for (const [index, supplement] of (legacy.suppDefs ?? []).entries()) {
    const name = str(supplement.name, `补剂 ${index + 1}`);
    const record = createRecord<SupplementDefinition>(userId, {
      name,
      kind: 'supplement',
      dose: str(supplement.dose) || undefined,
      times: Array.isArray(supplement.times)
        ? supplement.times.map((time) => supplementTime(String(time)))
        : ['morning'],
      trainingOnly: Boolean(supplement.trainOnly),
    });
    record.id = legacyStableId(userId, 'supplement', [str(supplement.id), name]);
    await saveRecord('supplement_definitions', record);
    counts.supplements += 1;
  }

  for (const [date, day] of Object.entries(legacy.days ?? {})) {
    for (const [key, completed] of Object.entries(day.supps ?? {})) {
      if (!completed) continue;
      const definition = (legacy.suppDefs ?? []).find((item) => key.startsWith(`${str(item.id)}_`));
      if (!definition) continue;
      const definitionId = str(definition.id);
      const rawTime = key.slice(definitionId.length + 1);
      const record = createRecord<SupplementCheckin>(userId, {
        date,
        supplementId: legacyStableId(userId, 'supplement', [definitionId, str(definition.name)]),
        time: supplementTime(rawTime),
        completed: true,
      });
      record.id = legacyStableId(userId, 'checkin', [date, key]);
      await saveRecord('supplement_checkins', record);
      counts.checkins += 1;
    }
  }

  if (legacy.split?.length) {
    const record = createRecord<TrainingPlan>(userId, {
      name: '旧版训练方案',
      days: legacy.split.map((day, index) => ({
        id: day.key || newId(),
        name: day.name || `训练日 ${index + 1}`,
        exercises: day.ex ?? [],
      })),
    });
    record.id = legacyStableId(userId, 'plan', ['default']);
    await saveRecord('training_plans', record);
    counts.plans = 1;
  }

  if (setMigrationMarker) {
    await db.meta.put({ key: `legacyMigrated:${userId}`, value: counts });
  }
  return counts;
}

export function deleteLegacyData(): void {
  localStorage.removeItem(LEGACY_KEY);
}
