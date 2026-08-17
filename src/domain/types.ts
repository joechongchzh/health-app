export type Gender = 'male' | 'female';
export type Goal = 'cut' | 'recomp' | 'bulk';
export type DayType = 'strength' | 'rest' | 'cardio';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type SupplementTime = 'morning' | 'noon' | 'evening' | 'post_training';
export type SyncState = 'local' | 'queued' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';

export interface BaseRecord {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface Profile extends BaseRecord {
  nickname: string;
  gender: Gender;
  birthDate: string;
  heightCm: number;
  weightKg: number;
  bodyFatPct?: number;
  activityFactor: number;
  goal: Goal;
  privacyAcceptedAt: string;
  onboardingCompleted: boolean;
}

export interface DayRecord extends BaseRecord {
  date: string;
  type: DayType;
  trainingTime: 'morning' | 'evening';
}

export interface MealEntry extends BaseRecord {
  date: string;
  meal: MealType;
  name: string;
  amount: string;
  carbs: number;
  protein: number;
  fat: number;
  estimated: boolean;
  foodId?: string;
}

export interface StrengthEntry {
  exercise: string;
  weightKg: number;
  reps: number;
  sets: number;
}

export interface Workout extends BaseRecord {
  date: string;
  kind: 'strength' | 'cardio';
  name: string;
  durationMin: number;
  calories: number;
  planDayId?: string;
  strengthEntries?: StrengthEntry[];
}

export interface WeightEntry extends BaseRecord {
  date: string;
  weightKg: number;
}

export interface Food extends BaseRecord {
  name: string;
  category: string;
  servingLabel: string;
  servingGrams?: number;
  carbs: number;
  protein: number;
  fat: number;
  source?: string;
  estimated: boolean;
  uses: number;
}

export interface ComboItem {
  foodId?: string;
  name: string;
  amount: string;
  carbs: number;
  protein: number;
  fat: number;
}

export interface Combo extends BaseRecord {
  name: string;
  items: ComboItem[];
  uses: number;
}

export interface SupplementDefinition extends BaseRecord {
  name: string;
  kind: 'supplement' | 'medicine';
  dose?: string;
  times: SupplementTime[];
  trainingOnly: boolean;
}

export interface SupplementCheckin extends BaseRecord {
  date: string;
  supplementId: string;
  time: SupplementTime;
  completed: boolean;
}

export interface TrainingDay {
  id: string;
  name: string;
  exercises: string[];
}

export interface TrainingPlan extends BaseRecord {
  name: string;
  days: TrainingDay[];
}

export interface AiEndpointConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface LocalAiSecrets {
  chat?: AiEndpointConfig;
  vision?: AiEndpointConfig;
  voice?: AiEndpointConfig;
}

export interface OutboxItem {
  id: string;
  userId: string;
  table: RemoteTable;
  recordId: string;
  operation: 'upsert' | 'delete';
  payload: BaseRecord;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export type RemoteTable =
  | 'profiles'
  | 'days'
  | 'meal_entries'
  | 'workouts'
  | 'weight_entries'
  | 'foods'
  | 'combos'
  | 'supplement_definitions'
  | 'supplement_checkins'
  | 'training_plans';

export interface ExportBundleV3 {
  format: 'health-data-v3';
  schemaVersion: 3;
  exportedAt: string;
  appVersion: string;
  data: {
    profile?: Profile;
    days: DayRecord[];
    meals: MealEntry[];
    workouts: Workout[];
    weights: WeightEntry[];
    foods: Food[];
    combos: Combo[];
    supplements: SupplementDefinition[];
    checkins: SupplementCheckin[];
    plans: TrainingPlan[];
  };
}

export interface NutritionTotals {
  carbs: number;
  protein: number;
  fat: number;
  calories: number;
}
