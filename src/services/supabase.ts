import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isCloudConfigured = Boolean(url && key);

export const supabase: SupabaseClient | null = isCloudConfigured
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('云端服务尚未配置，请联系应用管理员。');
  }
  return supabase;
}

export async function sendMagicLink(email: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
    },
  });
  if (error) throw error;
}

export async function redeemInvite(code: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.functions.invoke('redeem-invite', { body: { code } });
  if (error) throw new Error('邀请码无效、已过期或次数已用完');
}

export async function isActiveMember(userId: string): Promise<boolean> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('memberships')
    .select('status')
    .eq('user_id', userId)
    .maybeSingle<{ status: string }>();
  if (error) throw error;
  return data?.status === 'active';
}

export async function deleteCloudAccount(): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.functions.invoke('delete-account');
  if (error) throw error;
}
