begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.com', '', now(), now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.com', '', now(), now(), now()),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.com', '', now(), now(), now());

insert into public.memberships (user_id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.days (id, user_id, version, payload)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 1,
   '{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","userId":"11111111-1111-4111-8111-111111111111","version":1,"createdAt":"2026-08-14T00:00:00Z","updatedAt":"2026-08-14T00:00:00Z","date":"2026-08-14","type":"rest","trainingTime":"evening"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 1,
   '{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","userId":"22222222-2222-4222-8222-222222222222","version":1,"createdAt":"2026-08-14T00:00:00Z","updatedAt":"2026-08-14T00:00:00Z","date":"2026-08-14","type":"rest","trainingTime":"evening"}');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set local request.jwt.claim.role = 'authenticated';

select is((select count(*)::integer from public.days), 1, 'user A reads only own rows');
select is((select user_id::text from public.days), '11111111-1111-4111-8111-111111111111', 'visible row belongs to A');
select throws_ok(
  $$insert into public.days (id,user_id,version,payload) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222',1,'{}')$$,
  '42501', null, 'A cannot insert B row'
);
select is_empty($$update public.days set version = 2 where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning 1$$, 'A cannot update B row');
select is_empty($$delete from public.days where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning 1$$, 'A cannot delete B row');
select ok(public.is_active_member(auth.uid()), 'A is active member');
select throws_ok(
  $$update public.days set version = 1 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '40001', 'stale record version', 'same version cannot overwrite an existing row'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claim.role = 'authenticated';
select is((select count(*)::integer from public.days), 0, 'non-member reads no rows');
select throws_ok(
  $$insert into public.days (id,user_id,version,payload) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','33333333-3333-4333-8333-333333333333',1,'{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","userId":"33333333-3333-4333-8333-333333333333"}')$$,
  '42501', null, 'non-member cannot insert'
);

select * from finish();
rollback;
