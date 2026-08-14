import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { bmi, dailyQuota, nutritionTotals, twoWeekWeightRate } from './domain/calculations';
import type {
  AiEndpointConfig,
  DayRecord,
  DayType,
  MealEntry,
  MealType,
  Profile,
  SupplementCheckin,
  SupplementDefinition,
  SupplementTime,
  SyncState,
  TrainingPlan,
  WeightEntry,
  Workout,
} from './domain/types';
import { profileInputSchema, safeErrorMessage, validateAiBaseUrl } from './domain/validation';
import { clearAiSecrets, clearUserLocalData, db, getAiSecrets, setAiSecrets } from './data/db';
import { downloadExport, exportUserData, importV3 } from './data/export';
import {
  createLegacyBackup,
  deleteLegacyData,
  getLegacyProfileDefaults,
  importLegacyJson,
  migrateLegacy,
  previewLegacyMigration,
  type LegacyPreview,
} from './data/migration';
import { createRecord, saveRecord, softDeleteRecord } from './data/repository';
import {
  deleteCloudAccount,
  isCloudConfigured,
  isActiveMember,
  redeemInvite,
  sendEmailCode,
  supabase,
  verifyEmailCode,
} from './services/supabase';
import { syncUser } from './services/sync';

type Tab = 'today' | 'food' | 'training' | 'ai' | 'me';

const today = () => new Date().toLocaleDateString('sv-SE');
const localDemoUser: User = {
  id: '00000000-0000-4000-8000-000000000001',
  app_metadata: {},
  user_metadata: { email: 'local@example.com' },
  aud: 'authenticated',
  created_at: new Date().toISOString(),
};

interface Snapshot {
  profile?: Profile;
  day?: DayRecord;
  meals: MealEntry[];
  workouts: Workout[];
  weights: WeightEntry[];
  plans: TrainingPlan[];
  supplements: SupplementDefinition[];
  checkins: SupplementCheckin[];
}

const emptySnapshot: Snapshot = {
  meals: [],
  workouts: [],
  weights: [],
  plans: [],
  supplements: [],
  checkins: [],
};

function Button({
  children,
  kind = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'ghost' | 'danger';
}) {
  return (
    <button className={`button ${kind}`} {...props}>
      {children}
    </button>
  );
}

function Card({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [invite, setInvite] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [verifiedUser, setVerifiedUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setVerifiedUser(data.user);
        setEmail(data.user.email ?? '');
      }
    });
  }, []);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await sendEmailCode(email.trim());
      setSent(true);
      setMessage('验证码已发送，请查看邮箱。');
    } catch (error) {
      setMessage(safeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (!verifiedUser) await verifyEmailCode(email.trim(), code.trim());
      const current = verifiedUser ?? (await supabase!.auth.getUser()).data.user;
      if (!current) throw new Error('登录失败');
      setVerifiedUser(current);
      if (!(await isActiveMember(current.id))) {
        if (!invite.trim()) throw new Error('首次使用请填写邀请码');
        await redeemInvite(invite.trim());
      }
      onAuthenticated(current);
    } catch (error) {
      setMessage(
        error instanceof Error && /邀请码|首次使用/.test(error.message)
          ? error.message
          : safeErrorMessage(error),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!isCloudConfigured) {
    return (
      <main className="auth-shell">
        <Card className="auth-card">
          <div className="brand-mark">健</div>
          <h1>健康追踪</h1>
          <p>云端服务尚未配置。正式部署需要设置 Supabase 环境变量。</p>
          {import.meta.env.DEV && (
            <Button onClick={() => onAuthenticated(localDemoUser)}>进入本地开发预览</Button>
          )}
        </Card>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <Card className="auth-card">
        <div className="brand-mark">健</div>
        <h1>欢迎使用健康追踪</h1>
        <p>正式版 v3.0.0 · 你的数据按账号隔离并支持多设备同步</p>
        <form onSubmit={sent || verifiedUser ? verify : send}>
          <Field label="邀请码（首次使用）">
            <input
              value={invite}
              onChange={(event) => setInvite(event.target.value)}
              autoComplete="one-time-code"
            />
          </Field>
          <Field label="邮箱">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              disabled={sent || Boolean(verifiedUser)}
            />
          </Field>
          {sent && !verifiedUser && (
            <Field label="邮箱六位验证码">
              <input
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                required
              />
            </Field>
          )}
          {message && <p className="notice">{message}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? '请稍候…' : verifiedUser ? '验证邀请并继续' : sent ? '登录并验证邀请' : '发送验证码'}
          </Button>
          {sent && !verifiedUser && (
            <Button
              type="button"
              kind="ghost"
              onClick={() => {
                setSent(false);
                setCode('');
              }}
            >
              修改邮箱
            </Button>
          )}
        </form>
      </Card>
    </main>
  );
}

function Onboarding({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [privacy, setPrivacy] = useState(false);
  const [form, setForm] = useState(() => ({
    nickname: '',
    gender: 'male',
    birthDate: '',
    heightCm: '',
    weightKg: '',
    bodyFatPct: '',
    activityFactor: '1.3',
    goal: 'cut',
    plan: 'four',
    ...getLegacyProfileDefaults(),
  }));
  const [message, setMessage] = useState('');
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const finish = async () => {
    const parsed = profileInputSchema.safeParse({
      nickname: form.nickname,
      gender: form.gender,
      birthDate: form.birthDate,
      heightCm: Number(form.heightCm),
      weightKg: Number(form.weightKg),
      bodyFatPct: form.bodyFatPct ? Number(form.bodyFatPct) : undefined,
      activityFactor: Number(form.activityFactor),
      goal: form.goal,
    });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? '请检查档案');
      return;
    }
    if (!privacy) {
      setMessage('请先确认隐私与医学边界');
      return;
    }
    const profile = createRecord<Profile>(userId, {
      ...parsed.data,
      privacyAcceptedAt: new Date().toISOString(),
      onboardingCompleted: true,
    });
    const names: Record<string, [string, string[]][]> = {
      three: [
        ['推', ['卧推', '上斜卧推', '推肩']],
        ['拉', ['高位下拉', '坐姿划船', '弯举']],
        ['腿', ['深蹲', '腿举', '腿弯举']],
      ],
      four: [
        ['胸', ['卧推', '上斜卧推']],
        ['肩', ['推肩', '侧平举']],
        ['背', ['高位下拉', '坐姿划船']],
        ['腿', ['深蹲', '腿举']],
      ],
      five: [
        ['胸', ['卧推']],
        ['背', ['高位下拉']],
        ['肩', ['推肩']],
        ['腿', ['深蹲']],
        ['手臂', ['弯举', '绳索下压']],
      ],
    };
    const plan = createRecord<TrainingPlan>(userId, {
      name: `${form.plan === 'three' ? '三' : form.plan === 'four' ? '四' : '五'}分化`,
      days: names[form.plan].map(([name, exercises]) => ({
        id: crypto.randomUUID(),
        name,
        exercises,
      })),
    });
    await saveRecord('profiles', profile);
    await saveRecord('training_plans', plan);
    await saveRecord(
      'weight_entries',
      createRecord<WeightEntry>(userId, {
        date: today(),
        weightKg: parsed.data.weightKg,
      }),
    );
    onDone();
  };

  return (
    <main className="onboarding-shell">
      <Card className="onboarding-card">
        <div className="progress">
          <i style={{ width: `${((step + 1) / 3) * 100}%` }} />
        </div>
        {step === 0 && (
          <>
            <h1>先说明数据与健康边界</h1>
            <p>
              数据通过 HTTPS 传输，并由 Supabase
              行级权限按账号隔离。项目管理员理论上可以访问云端明文数据；本应用不提供端到端加密。
            </p>
            <p>应用面向成年人日常健康管理，不提供医学诊断、处方或特殊人群治疗建议。</p>
            <label className="check">
              <input
                type="checkbox"
                checked={privacy}
                onChange={(event) => setPrivacy(event.target.checked)}
              />
              我已阅读并同意隐私说明
            </label>
          </>
        )}
        {step === 1 && (
          <>
            <h1>建立你的身体档案</h1>
            <div className="form-grid">
              <Field label="昵称">
                <input value={form.nickname} onChange={(event) => update('nickname', event.target.value)} />
              </Field>
              <Field label="性别">
                <select value={form.gender} onChange={(event) => update('gender', event.target.value)}>
                  <option value="male">男</option>
                  <option value="female">女</option>
                </select>
              </Field>
              <Field label="生日">
                <input
                  type="date"
                  value={form.birthDate}
                  onChange={(event) => update('birthDate', event.target.value)}
                />
              </Field>
              <Field label="身高（cm）">
                <input
                  type="number"
                  min="120"
                  max="230"
                  value={form.heightCm}
                  onChange={(event) => update('heightCm', event.target.value)}
                />
              </Field>
              <Field label="体重（kg）">
                <input
                  type="number"
                  min="35"
                  max="300"
                  step="0.1"
                  value={form.weightKg}
                  onChange={(event) => update('weightKg', event.target.value)}
                />
              </Field>
              <Field label="体脂率（可选）">
                <input
                  type="number"
                  min="3"
                  max="70"
                  step="0.1"
                  value={form.bodyFatPct}
                  onChange={(event) => update('bodyFatPct', event.target.value)}
                />
              </Field>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h1>选择目标与训练方案</h1>
            <Field label="目标">
              <select value={form.goal} onChange={(event) => update('goal', event.target.value)}>
                <option value="cut">减脂</option>
                <option value="recomp">塑形</option>
                <option value="bulk">增肌</option>
              </select>
            </Field>
            <Field label="日常活动系数">
              <select
                value={form.activityFactor}
                onChange={(event) => update('activityFactor', event.target.value)}
              >
                <option value="1.2">久坐</option>
                <option value="1.3">轻度活动</option>
                <option value="1.5">中度活动</option>
                <option value="1.7">高度活动</option>
              </select>
            </Field>
            <Field label="训练方案">
              <select value={form.plan} onChange={(event) => update('plan', event.target.value)}>
                <option value="three">三分化</option>
                <option value="four">四分化</option>
                <option value="five">五分化</option>
              </select>
            </Field>
          </>
        )}
        {message && <p className="notice error">{message}</p>}
        <div className="button-row">
          {step > 0 && (
            <Button kind="ghost" onClick={() => setStep((value) => value - 1)}>
              上一步
            </Button>
          )}
          <Button onClick={() => (step < 2 ? setStep((value) => value + 1) : void finish())}>
            {step < 2 ? '下一步' : '开始使用'}
          </Button>
        </div>
      </Card>
    </main>
  );
}

function TodayPage({ data, setDayType }: { data: Snapshot; setDayType: (type: DayType) => Promise<void> }) {
  if (!data.profile || !data.day) return null;
  const totals = nutritionTotals(data.meals);
  const quota = dailyQuota(data.profile, data.day, data.workouts);
  return (
    <div className="page-stack">
      <header className="hero">
        <div>
          <small>{today()}</small>
          <h1>你好，{data.profile.nickname}</h1>
          <p>今天也做一点对未来有用的事。</p>
        </div>
        <div className="score-ring">
          {Math.min(100, Math.round((totals.calories / quota.calories) * 100))}%
        </div>
      </header>
      <Card title="今天是什么日子？">
        <div className="segmented">
          {(['strength', 'cardio', 'rest'] as DayType[]).map((type) => (
            <button
              key={type}
              className={data.day!.type === type ? 'active' : ''}
              onClick={() => void setDayType(type)}
            >
              {type === 'strength' ? '力量日' : type === 'cardio' ? '有氧日' : '休息日'}
            </button>
          ))}
        </div>
      </Card>
      <div className="metric-grid">
        {(
          [
            ['碳水', totals.carbs, quota.carbs],
            ['蛋白', totals.protein, quota.protein],
            ['脂肪', totals.fat, quota.fat],
            ['热量', totals.calories, quota.calories],
          ] as const
        ).map(([label, value, target]) => (
          <Card key={label}>
            <small>{label}</small>
            <strong>{Math.round(value)}</strong>
            <span>
              / {target}
              {label === '热量' ? ' kcal' : ' g'}
            </span>
            <progress max={target} value={Math.min(value, target)} />
          </Card>
        ))}
      </div>
      <Card title="今日概览">
        <div className="summary-row">
          <span>饮食记录</span>
          <strong>{data.meals.length} 条</strong>
        </div>
        <div className="summary-row">
          <span>训练记录</span>
          <strong>{data.workouts.length} 条</strong>
        </div>
      </Card>
    </div>
  );
}

function FoodPage({
  userId,
  meals,
  refresh,
}: {
  userId: string;
  meals: MealEntry[];
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    meal: 'lunch',
    name: '',
    amount: '1 份',
    carbs: '',
    protein: '',
    fat: '',
    estimated: true,
  });
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    await saveRecord(
      'meal_entries',
      createRecord<MealEntry>(userId, {
        date: today(),
        meal: form.meal as MealType,
        name: form.name.trim(),
        amount: form.amount.trim(),
        carbs: Number(form.carbs),
        protein: Number(form.protein),
        fat: Number(form.fat),
        estimated: form.estimated,
      }),
    );
    setForm((value) => ({
      ...value,
      name: '',
      carbs: '',
      protein: '',
      fat: '',
    }));
    await refresh();
  };
  return (
    <div className="page-stack">
      <Card title="记录饮食">
        <form onSubmit={add} className="form-grid">
          <Field label="餐次">
            <select value={form.meal} onChange={(e) => setForm({ ...form, meal: e.target.value })}>
              <option value="breakfast">早餐</option>
              <option value="lunch">午餐</option>
              <option value="dinner">晚餐</option>
              <option value="snack">加餐</option>
            </select>
          </Field>
          <Field label="食物">
            <input
              value={form.name}
              maxLength={80}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </Field>
          <Field label="份量">
            <input
              value={form.amount}
              maxLength={30}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
          {(['carbs', 'protein', 'fat'] as const).map((key) => (
            <Field key={key} label={key === 'carbs' ? '碳水 g' : key === 'protein' ? '蛋白 g' : '脂肪 g'}>
              <input
                type="number"
                min="0"
                max="1000"
                step="0.1"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                required
              />
            </Field>
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={form.estimated}
              onChange={(e) => setForm({ ...form, estimated: e.target.checked })}
            />
            估算数据
          </label>
          <Button type="submit">添加</Button>
        </form>
      </Card>
      <Card title="今天吃了什么">
        {meals.length === 0 ? (
          <p className="empty">还没有记录</p>
        ) : (
          meals.map((meal) => (
            <div className="list-item" key={meal.id}>
              <div>
                <strong>{meal.name}</strong>
                <small>
                  {meal.amount} · 碳 {meal.carbs} / 蛋白 {meal.protein} / 脂肪 {meal.fat}
                  {meal.estimated ? ' · 估算' : ''}
                </small>
              </div>
              <Button
                kind="ghost"
                onClick={async () => {
                  await softDeleteRecord('meal_entries', meal);
                  await refresh();
                }}
              >
                删除
              </Button>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

function TrainingPage({
  userId,
  workouts,
  plans,
  refresh,
}: {
  userId: string;
  workouts: Workout[];
  plans: TrainingPlan[];
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    kind: 'strength',
    name: '',
    duration: '',
    calories: '',
  });
  const add = async (event: FormEvent) => {
    event.preventDefault();
    await saveRecord(
      'workouts',
      createRecord<Workout>(userId, {
        date: today(),
        kind: form.kind as 'strength' | 'cardio',
        name: form.name.trim() || (form.kind === 'strength' ? '力量训练' : '有氧训练'),
        durationMin: Number(form.duration),
        calories: Number(form.calories),
      }),
    );
    setForm({ ...form, name: '', duration: '', calories: '' });
    await refresh();
  };
  return (
    <div className="page-stack">
      <Card title="记录训练">
        <form onSubmit={add} className="form-grid">
          <Field label="类型">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="strength">力量</option>
              <option value="cardio">有氧</option>
            </select>
          </Field>
          <Field label="名称">
            <input
              value={form.name}
              maxLength={80}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="时长（分钟）">
            <input
              type="number"
              min="1"
              max="600"
              value={form.duration}
              onChange={(e) => setForm({ ...form, duration: e.target.value })}
              required
            />
          </Field>
          <Field label="消耗（kcal）">
            <input
              type="number"
              min="0"
              max="5000"
              value={form.calories}
              onChange={(e) => setForm({ ...form, calories: e.target.value })}
              required
            />
          </Field>
          <Button type="submit">完成训练</Button>
        </form>
      </Card>
      {plans[0] && (
        <Card title={`当前方案 · ${plans[0].name}`}>
          <div className="plan-grid">
            {plans[0].days.map((day) => (
              <div key={day.id}>
                <strong>{day.name}</strong>
                <small>{day.exercises.join(' · ')}</small>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="今天的训练">
        {workouts.length === 0 ? (
          <p className="empty">还没有训练记录</p>
        ) : (
          workouts.map((workout) => (
            <div className="list-item" key={workout.id}>
              <div>
                <strong>{workout.name}</strong>
                <small>
                  {workout.durationMin} 分钟 · {workout.calories} kcal
                </small>
              </div>
              <Button
                kind="ghost"
                onClick={async () => {
                  await softDeleteRecord('workouts', workout);
                  await refresh();
                }}
              >
                删除
              </Button>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}
function AiPage({ profile }: { profile: Profile }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'user', text }]);
    setBusy(true);
    try {
      const config = (await getAiSecrets()).chat;
      if (!config) throw new Error('请先在“我的 → AI 接口”配置文字模型');
      const url = new URL(
        'chat/completions',
        validateAiBaseUrl(config.baseUrl).toString().replace(/\/?$/, '/'),
      );
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'system',
              content: `你是${profile.nickname || '用户'}的日常健康助手。只提供一般健康管理信息，不做诊断或处方。需要修改数据时只提出建议，等待用户在界面确认。`,
            },
            ...messages.map(({ role, text }) => ({ role, content: text })),
            { role: 'user', content: text },
          ],
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const reply = payload.choices?.[0]?.message?.content?.trim() || '模型没有返回内容。';
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', text: reply }]);
    } catch (error) {
      setMessages((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text:
            error instanceof Error && error.message.startsWith('请先')
              ? error.message
              : safeErrorMessage(error),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-stack">
      <Card title="AI 健康助手">
        <p className="muted">
          AI 可能出错。任何写入动作都必须由你确认；对话不会上传到健康数据云端或导出文件。
        </p>
        <div className="chat">
          {messages.length === 0 && <p className="empty">可以询问饮食、训练或趋势，但不要用它替代医生。</p>}
          {messages.map((message) => (
            <p key={message.id} className={`bubble ${message.role}`}>
              {message.text}
            </p>
          ))}
        </div>
        <form onSubmit={send} className="chat-form">
          <textarea
            value={input}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例如：今天蛋白质还差多少？"
          />
          <Button type="submit" disabled={busy}>
            {busy ? '思考中…' : '发送'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function EndpointEditor({ kind, label }: { kind: 'chat' | 'vision' | 'voice'; label: string }) {
  const [config, setConfig] = useState<AiEndpointConfig>({
    baseUrl: 'https://api.openai.com/v1/',
    apiKey: '',
    model: '',
  });
  const [message, setMessage] = useState('');
  useEffect(() => {
    void getAiSecrets().then((secrets) => {
      if (secrets[kind]) setConfig(secrets[kind]!);
    });
  }, [kind]);
  const save = async () => {
    try {
      validateAiBaseUrl(config.baseUrl);
      if (!config.apiKey.trim() || !config.model.trim()) throw new Error('请填写 Key 和模型名');
      const secrets = await getAiSecrets();
      await setAiSecrets({ ...secrets, [kind]: config });
      setMessage('已仅保存在当前设备');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : safeErrorMessage(error));
    }
  };
  return (
    <details>
      <summary>{label}</summary>
      <div className="form-grid compact">
        <Field label="Base URL">
          <input
            type="url"
            value={config.baseUrl}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
          />
        </Field>
        <Field label="模型名">
          <input value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} />
        </Field>
        <Field label="API Key">
          <input
            type="password"
            autoComplete="off"
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
          />
        </Field>
        <Button onClick={() => void save()}>保存并校验</Button>
        {message && <small>{message}</small>}
      </div>
    </details>
  );
}

function MePage({
  userId,
  data,
  refresh,
  onSignOut,
}: {
  userId: string;
  data: Snapshot;
  refresh: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [weight, setWeight] = useState('');
  const [supplement, setSupplement] = useState({
    name: '',
    dose: '',
    time: 'morning',
  });
  const [message, setMessage] = useState('');
  const rate = twoWeekWeightRate(data.weights);
  const sorted = [...data.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-12);
  const points = sorted
    .map(
      (item, index) =>
        `${sorted.length === 1 ? 150 : (index / (sorted.length - 1)) * 300},${100 - ((item.weightKg - Math.min(...sorted.map((x) => x.weightKg), item.weightKg)) / Math.max(1, Math.max(...sorted.map((x) => x.weightKg), item.weightKg) - Math.min(...sorted.map((x) => x.weightKg), item.weightKg))) * 80}`,
    )
    .join(' ');
  const addWeight = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(weight);
    if (value < 35 || value > 300) {
      setMessage('体重应在 35–300 kg 之间');
      return;
    }
    await saveRecord('weight_entries', createRecord<WeightEntry>(userId, { date: today(), weightKg: value }));
    setWeight('');
    await refresh();
  };
  const addSupplement = async (event: FormEvent) => {
    event.preventDefault();
    if (!supplement.name.trim()) return;
    await saveRecord(
      'supplement_definitions',
      createRecord<SupplementDefinition>(userId, {
        name: supplement.name.trim(),
        dose: supplement.dose.trim() || undefined,
        kind: 'supplement',
        times: [supplement.time as SupplementTime],
        trainingOnly: false,
      }),
    );
    setSupplement({ name: '', dose: '', time: 'morning' });
    await refresh();
  };
  const toggleSupplement = async (definition: SupplementDefinition, time: SupplementTime) => {
    const current = data.checkins.find(
      (item) => item.supplementId === definition.id && item.time === time && item.date === today(),
    );
    if (current) {
      await saveRecord('supplement_checkins', {
        ...current,
        completed: !current.completed,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      });
    } else {
      await saveRecord(
        'supplement_checkins',
        createRecord<SupplementCheckin>(userId, {
          date: today(),
          supplementId: definition.id,
          time,
          completed: true,
        }),
      );
    }
    await refresh();
  };
  const exportData = async () => downloadExport(await exportUserData(userId));
  const importData = async (file?: File) => {
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      if (bundle?.format === 'health-data-v3') {
        const count = await importV3(bundle, userId);
        setMessage(`已导入 ${count} 条 v3 新记录`);
      } else {
        const counts = await importLegacyJson(bundle, userId);
        const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
        setMessage(`已转换并导入 ${total} 条旧版记录`);
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : safeErrorMessage(error));
    }
  };
  const removeAccount = async () => {
    if (!confirm('确定永久删除账号、云端数据、本地数据和本机 AI Key 吗？此操作不可恢复。')) return;
    if (!confirm('请再次确认：删除后无法找回。是否继续？')) return;
    try {
      if (isCloudConfigured) await deleteCloudAccount();
      await clearUserLocalData(userId);
      await clearAiSecrets();
      await onSignOut();
    } catch (error) {
      setMessage(safeErrorMessage(error));
    }
  };
  return (
    <div className="page-stack">
      <Card title="体重趋势">
        <form onSubmit={addWeight} className="inline-form">
          <input
            type="number"
            min="35"
            max="300"
            step="0.1"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="今天体重 kg"
          />
          <Button type="submit">记录</Button>
        </form>
        {sorted.length ? (
          <svg className="trend" viewBox="0 0 300 110" role="img" aria-label="近期体重趋势">
            <polyline
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <p className="empty">暂无趋势</p>
        )}
        <p>{rate === null ? '积累至少约两周数据后显示变化速度' : `近两周每周体重变化 ${rate}%`}</p>
      </Card>
      <Card title="个人档案">
        {data.profile && (
          <div className="summary">
            <strong>{data.profile.nickname}</strong>
            <span>
              {data.profile.heightCm} cm · {data.profile.weightKg} kg · BMI {bmi(data.profile).toFixed(1)}
            </span>
            <span>
              目标：
              {data.profile.goal === 'cut' ? '减脂' : data.profile.goal === 'bulk' ? '增肌' : '塑形'}
            </span>
          </div>
        )}
      </Card>
      <Card title="补剂与用药打卡">
        <form onSubmit={addSupplement} className="form-grid compact">
          <Field label="名称">
            <input
              value={supplement.name}
              maxLength={60}
              onChange={(event) => setSupplement({ ...supplement, name: event.target.value })}
              placeholder="例如：鱼油"
              required
            />
          </Field>
          <Field label="剂量（可选）">
            <input
              value={supplement.dose}
              maxLength={40}
              onChange={(event) => setSupplement({ ...supplement, dose: event.target.value })}
            />
          </Field>
          <Field label="时间">
            <select
              value={supplement.time}
              onChange={(event) => setSupplement({ ...supplement, time: event.target.value })}
            >
              <option value="morning">早</option>
              <option value="noon">午</option>
              <option value="evening">晚</option>
              <option value="post_training">练后</option>
            </select>
          </Field>
          <Button type="submit">添加项目</Button>
        </form>
        <div className="checkin-grid">
          {data.supplements.map((definition) =>
            definition.times.map((time) => {
              const checked = data.checkins.some(
                (item) =>
                  item.supplementId === definition.id &&
                  item.time === time &&
                  item.date === today() &&
                  item.completed,
              );
              const timeLabel = {
                morning: '早',
                noon: '午',
                evening: '晚',
                post_training: '练后',
              }[time];
              return (
                <button
                  key={`${definition.id}:${time}`}
                  className={checked ? 'checkin active' : 'checkin'}
                  onClick={() => void toggleSupplement(definition, time)}
                >
                  {checked ? '✓ ' : ''}
                  {definition.name} · {timeLabel}
                  {definition.dose ? ` · ${definition.dose}` : ''}
                </button>
              );
            }),
          )}
        </div>
      </Card>
      <Card title="AI 接口（仅本机）">
        <p className="muted">
          支持 OpenAI 兼容 HTTPS 接口。Key 不同步、不导出、不写入日志。保存前请确认域名属于你信任的服务商。
        </p>
        <EndpointEditor kind="chat" label="文字模型" />
        <EndpointEditor kind="vision" label="视觉模型" />
        <EndpointEditor kind="voice" label="语音模型" />
        <Button
          kind="ghost"
          onClick={async () => {
            await clearAiSecrets();
            setMessage('本机 AI Key 已清除');
          }}
        >
          一键清除全部 AI Key
        </Button>
      </Card>
      <Card title="安装与数据">
        <p>
          <strong>iPhone：</strong>用 Safari 打开，点“分享”→“添加到主屏幕”。
        </p>
        <p>
          <strong>Android：</strong>用 Chrome 打开，按安装提示，或菜单→“安装应用”。
        </p>
        <div className="button-row">
          <Button onClick={() => void exportData()}>导出 JSON 备份</Button>
          <label className="button ghost file-button">
            导入 v3 备份
            <input
              type="file"
              accept="application/json"
              onChange={(e) => void importData(e.target.files?.[0])}
            />
          </label>
        </div>
        <p className="muted">
          离线记录保存在本机 IndexedDB；恢复联网、回到前台或手动同步时上传。iOS 不依赖后台同步。
        </p>
      </Card>
      <Card title="账号">
        <Button kind="ghost" onClick={() => void onSignOut()}>
          退出登录
        </Button>
        <Button kind="danger" onClick={() => void removeAccount()}>
          永久删除账号
        </Button>
      </Card>
      {message && <p className="notice">{message}</p>}
    </div>
  );
}

function MigrationDialog({
  preview,
  userId,
  onDone,
}: {
  preview: LegacyPreview;
  userId: string;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [migrated, setMigrated] = useState(false);
  const [message, setMessage] = useState('');
  const run = async () => {
    setBusy(true);
    try {
      createLegacyBackup();
      const counts = await migrateLegacy(userId);
      setMessage(
        `迁移完成：${counts.days} 天、${counts.meals} 餐、${counts.workouts} 次训练、${counts.weights} 条体重。`,
      );
      setMigrated(true);
      await onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : safeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <Card className="modal">
        <h1>发现旧版健康数据</h1>
        <p>
          共检测到 {preview.counts.days} 天、{preview.counts.meals} 条饮食、
          {preview.counts.workouts} 条训练和 {preview.counts.weights} 条体重记录。迁移前会自动下载原始备份。
        </p>
        {message && <p className="notice">{message}</p>}
        {!migrated ? (
          <div className="button-row">
            <Button onClick={() => void run()} disabled={busy}>
              {busy ? '正在迁移…' : '备份并迁移'}
            </Button>
            <Button kind="ghost" onClick={() => void onDone()}>
              稍后处理
            </Button>
          </div>
        ) : (
          <div className="button-row">
            <Button onClick={() => void onDone()}>保留旧数据并继续</Button>
            <Button
              kind="danger"
              onClick={() => {
                if (confirm('确认删除浏览器中的旧版 localStorage 数据？已下载的备份不受影响。')) {
                  deleteLegacyData();
                  void onDone();
                }
              }}
            >
              删除旧版数据
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function MainApp({ user, onSignOut }: { user: User; onSignOut: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>('today');
  const [data, setData] = useState<Snapshot>(emptySnapshot);
  const [syncState, setSyncState] = useState<SyncState>(navigator.onLine ? 'local' : 'offline');
  const [syncMessage, setSyncMessage] = useState('');
  const [legacy, setLegacy] = useState<LegacyPreview | null>(null);
  const [showTips, setShowTips] = useState(false);

  const refresh = useCallback(async () => {
    const [profiles, days, meals, workouts, weights, plans, supplements, checkins] = await Promise.all([
      db.profiles.where('userId').equals(user.id).toArray(),
      db.days.where('[userId+date]').equals([user.id, today()]).toArray(),
      db.meals.where('[userId+date]').equals([user.id, today()]).toArray(),
      db.workouts.where('[userId+date]').equals([user.id, today()]).toArray(),
      db.weights.where('userId').equals(user.id).toArray(),
      db.plans.where('userId').equals(user.id).toArray(),
      db.supplements.where('userId').equals(user.id).toArray(),
      db.checkins.where('[userId+date]').equals([user.id, today()]).toArray(),
    ]);
    let day = days.find((row) => !row.deletedAt);
    if (!day) {
      day = createRecord<DayRecord>(user.id, {
        date: today(),
        type: 'rest',
        trainingTime: 'evening',
      });
      await saveRecord('days', day);
    }
    setData({
      profile: profiles.find((row) => !row.deletedAt),
      day,
      meals: meals.filter((row) => !row.deletedAt),
      workouts: workouts.filter((row) => !row.deletedAt),
      weights: weights.filter((row) => !row.deletedAt),
      plans: plans.filter((row) => !row.deletedAt),
      supplements: supplements.filter((row) => !row.deletedAt),
      checkins: checkins.filter((row) => !row.deletedAt),
    });
  }, [user.id]);

  const sync = useCallback(async () => {
    if (!isCloudConfigured) {
      setSyncState(navigator.onLine ? 'local' : 'offline');
      return;
    }
    setSyncState('syncing');
    try {
      const result = await syncUser(user.id);
      setSyncState(result.state);
      setSyncMessage(result.message);
      await refresh();
    } catch (error) {
      setSyncState('error');
      setSyncMessage(safeErrorMessage(error));
    }
  }, [refresh, user.id]);

  useEffect(() => {
    void refresh().then(() => {
      const preview = previewLegacyMigration();
      if (preview.exists) setLegacy(preview);
    });
    const first = localStorage.getItem('health-v3-tips-seen') !== '1';
    setShowTips(first);
  }, [refresh]);
  useEffect(() => {
    const online = () => void sync();
    const visible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    void sync();
    return () => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [sync]);

  const setDayType = async (type: DayType) => {
    if (!data.day) return;
    await saveRecord('days', {
      ...data.day,
      type,
      version: data.day.version + 1,
      updatedAt: new Date().toISOString(),
    });
    await refresh();
  };
  if (legacy) {
    return (
      <MigrationDialog
        preview={legacy}
        userId={user.id}
        onDone={async () => {
          setLegacy(null);
          await refresh();
        }}
      />
    );
  }
  if (!data.profile) return <Onboarding userId={user.id} onDone={refresh} />;

  const labels: Array<[Tab, string, string]> = [
    ['today', '今日', '⌂'],
    ['food', '饮食', '◒'],
    ['training', '训练', '◆'],
    ['ai', 'AI', '✦'],
    ['me', '我的', '○'],
  ];
  return (
    <div className="app-shell">
      <header className="topbar">
        <strong>健康追踪</strong>
        <button className={`sync ${syncState}`} onClick={() => void sync()}>
          {syncState === 'syncing'
            ? '同步中…'
            : syncState === 'synced'
              ? '已同步'
              : syncState === 'offline'
                ? '离线待同步'
                : syncState === 'conflict'
                  ? '已处理冲突'
                  : syncState === 'error'
                    ? '同步失败'
                    : '本地保存'}
        </button>
      </header>
      <main className="content">
        {tab === 'today' && <TodayPage data={data} setDayType={setDayType} />}
        {tab === 'food' && <FoodPage userId={user.id} meals={data.meals} refresh={refresh} />}
        {tab === 'training' && (
          <TrainingPage userId={user.id} workouts={data.workouts} plans={data.plans} refresh={refresh} />
        )}
        {tab === 'ai' && <AiPage profile={data.profile} />}
        {tab === 'me' && <MePage userId={user.id} data={data} refresh={refresh} onSignOut={onSignOut} />}
      </main>
      <nav className="bottom-nav" aria-label="主导航">
        {labels.map(([value, label, icon]) => (
          <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>
            <i>{icon}</i>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {syncMessage && syncState !== 'synced' && <div className="toast">{syncMessage}</div>}
      {showTips && (
        <div className="modal-backdrop">
          <Card className="modal">
            <h1>五步开始</h1>
            <ol>
              <li>在“饮食”记录第一餐</li>
              <li>在“训练”完成一次打卡</li>
              <li>在“我的”记录体重和补剂</li>
              <li>留意顶部同步状态</li>
              <li>AI 为选配，Key 只保存在本机</li>
            </ol>
            <Button
              onClick={() => {
                localStorage.setItem('health-v3-tips-seen', '1');
                setShowTips(false);
              }}
            >
              知道了
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="update-banner">
      <span>发现新版本，刷新后生效。</span>
      <Button onClick={() => void updateServiceWorker(true)}>立即更新</Button>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const acceptSession = async (candidate: User | null) => {
      try {
        setUser(candidate && (await isActiveMember(candidate.id)) ? candidate : null);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    void supabase.auth.getSession().then(({ data }) => acceptSession(data.session?.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void acceptSession(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  };
  if (loading) return <main className="loading">正在加载健康数据…</main>;
  return (
    <>
      <UpdatePrompt />
      {user ? <MainApp user={user} onSignOut={signOut} /> : <AuthScreen onAuthenticated={setUser} />}
    </>
  );
}
