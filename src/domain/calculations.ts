import type { DayRecord, Goal, MealEntry, NutritionTotals, Profile, Workout } from './types';

export function ageOn(birthDate: string, now = new Date()): number {
  const birth = new Date(`${birthDate}T00:00:00`);
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return Math.max(0, age);
}

export function bmi(profile: Pick<Profile, 'heightCm' | 'weightKg'>): number {
  return profile.weightKg / (profile.heightCm / 100) ** 2;
}

export function bmr(profile: Profile, now = new Date()): number {
  if (profile.bodyFatPct && profile.bodyFatPct > 0) {
    return Math.round(370 + 21.6 * profile.weightKg * (1 - profile.bodyFatPct / 100));
  }
  const sexOffset = profile.gender === 'male' ? 5 : -161;
  return Math.round(
    10 * profile.weightKg + 6.25 * profile.heightCm - 5 * ageOn(profile.birthDate, now) + sexOffset,
  );
}

export function nutritionTotals(entries: MealEntry[]): NutritionTotals {
  const result = entries.reduce(
    (sum, item) => ({
      carbs: sum.carbs + item.carbs,
      protein: sum.protein + item.protein,
      fat: sum.fat + item.fat,
    }),
    { carbs: 0, protein: 0, fat: 0 },
  );
  return { ...result, calories: Math.round(result.carbs * 4 + result.protein * 4 + result.fat * 9) };
}

function quotaFactors(profile: Profile) {
  const profileBmi = bmi(profile);
  const protein = profile.goal === 'bulk' ? 1.8 : 1.6;
  const fat = profile.gender === 'female' ? 1 : 0.8;
  if (profile.goal === 'bulk') return { protein, fat, strengthCarbs: 4, restCarbs: 3 };
  if (profile.goal === 'recomp') return { protein, fat, strengthCarbs: 3.5, restCarbs: 2.5 };
  return {
    protein,
    fat,
    strengthCarbs: profileBmi >= 28 ? 2.7 : 3,
    restCarbs: profileBmi >= 28 ? 2 : 2.5,
  };
}

export function dailyQuota(profile: Profile, day: DayRecord, workouts: Workout[]): NutritionTotals {
  const factor = quotaFactors(profile);
  const cardioCalories = workouts
    .filter((workout) => workout.kind === 'cardio')
    .reduce((sum, workout) => sum + workout.calories, 0);
  const baseCarbs = day.type === 'strength' ? factor.strengthCarbs : factor.restCarbs;
  const carbs = Math.round(baseCarbs * profile.weightKg + cardioCalories / 4);
  const protein = Math.round(factor.protein * profile.weightKg);
  const fat = Math.round(factor.fat * profile.weightKg);
  return { carbs, protein, fat, calories: carbs * 4 + protein * 4 + fat * 9 };
}

export function dailyBurn(profile: Profile, workouts: Workout[], now = new Date()): number {
  return Math.round(
    bmr(profile, now) * profile.activityFactor + workouts.reduce((sum, workout) => sum + workout.calories, 0),
  );
}

export function healthyDeficitBand(goal: Goal): [number, number] {
  if (goal === 'bulk') return [-15, -5];
  if (goal === 'recomp') return [-5, 8];
  return [10, 22];
}

export function twoWeekWeightRate(weights: Array<{ date: string; weightKg: number }>): number | null {
  if (weights.length < 2) return null;
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1)!;
  const latestTime = new Date(`${latest.date}T00:00:00`).getTime();
  const candidates = sorted.filter((item) => {
    const days = (latestTime - new Date(`${item.date}T00:00:00`).getTime()) / 86_400_000;
    return days >= 8 && days <= 20;
  });
  if (!candidates.length) return null;
  const baseline = candidates.reduce((best, item) => {
    const itemDays = (latestTime - new Date(`${item.date}T00:00:00`).getTime()) / 86_400_000;
    const bestDays = (latestTime - new Date(`${best.date}T00:00:00`).getTime()) / 86_400_000;
    return Math.abs(itemDays - 14) < Math.abs(bestDays - 14) ? item : best;
  });
  const spanDays = (latestTime - new Date(`${baseline.date}T00:00:00`).getTime()) / 86_400_000;
  const weeklyChange = ((latest.weightKg - baseline.weightKg) / baseline.weightKg) * (7 / spanDays) * 100;
  return Number(weeklyChange.toFixed(2));
}
