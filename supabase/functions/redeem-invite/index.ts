import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) throw new Error('missing authorization');
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
    });
    const body = await request.json();
    if (typeof body.code !== 'string' || body.code.trim().length < 4 || body.code.length > 128) {
      return Response.json({ error: '邀请码无效' }, { status: 400, headers: corsHeaders });
    }
    const { data, error } = await client.rpc('redeem_invite_code', { raw_code: body.code.trim() });
    if (error) throw error;
    return Response.json({ redeemed: data === true }, { headers: corsHeaders });
  } catch {
    return Response.json({ error: '邀请码无效、已过期或次数已用完' }, { status: 403, headers: corsHeaders });
  }
});
