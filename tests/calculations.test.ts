import { describe, expect, it } from 'vitest';
import { ageOn, bmr, dailyQuota, twoWeekWeightRate } from '../src/domain/calculations';
import type { DayRecord, Profile } from '../src/domain/types';

const profile: Profile = {
  id: 'p',
  userId: 'u',
  createdAt: '',
  updatedAt: '',
  version: 1,
  nickname: '测试用户',
  gender: 'female',
  birthDate: '1996-01-01',
  heightCm: 165,
  weightKg: 60,
  activityFactor: 1.3,
  goal: 'cut',
  privacyAcceptedAt: '',
  onboardingCompleted: true,
};

const day: DayRecord = {
  id: 'd',
  userId: 'u',
  createdAt: '',
  updatedAt: '',
  version: 1,
  date: '2026-08-14',
  type: 'strength',
  trainingTime: 'evening',
};

describe('健康算法', () => {
  it('按生日计算周岁', () => {
    expect(ageOn('2000-11-02', new Date('2026-08-14T00:00:00'))).toBe(25);
  });

  it('女性 Mifflin-St Jeor 公式使用 -161', () => {
    expect(bmr(profile, new Date('2026-08-14T00:00:00'))).toBe(1320);
  });

  it('力量日配额按个人参数计算', () => {
    expect(dailyQuota(profile, day, [])).toEqual({ carbs: 180, protein: 96, fat: 60, calories: 1644 });
  });

  it('两周趋势返回体重百分比而不是固定公斤', () => {
    expect(
      twoWeekWeightRate([
        { date: '2026-08-01', weightKg: 100 },
        { date: '2026-08-15', weightKg: 98 },
      ]),
    ).toBe(-1);
  });
});
