-- ============================================================
-- מנגנון הזמנות לתפקידים רגישים (מנהל / הנהלת חשבונות)
-- מונע ממשתמש רגיל להעניק לעצמו תפקיד ניהולי, גם אם ינסה לעקוף את הממשק
-- ============================================================

-- טבלת הזמנות: רק מנהל יכול ליצור הזמנה למייל מסוים עם תפקיד מסוים
create table if not exists fl_role_invites (
  email text primary key,
  role text not null check (role in ('manager','accountant')),
  created_at timestamptz not null default now(),
  created_by uuid references fl_profiles(id)
);
alter table fl_role_invites enable row level security;

create policy "fl manager manages invites" on fl_role_invites for all
  using (fl_is_manager()) with check (fl_is_manager());

-- טריגר: בזמן הרשמה, אם קיימת הזמנה תואמת למייל - מחליף את התפקיד שנבחר בתפריט
-- בתפקיד מההזמנה, ומוחק את ההזמנה (שימוש חד-פעמי).
-- אם אין הזמנה תואמת, ומישהו בכל זאת ניסה לשלוח role שאינו photographer/recorder - נחסם.
create or replace function fl_apply_role_invite() returns trigger as $$
declare
  invite record;
begin
  select * into invite from fl_role_invites where lower(email) = lower(NEW.email) limit 1;
  if invite is not null then
    NEW.role := invite.role;
    delete from fl_role_invites where lower(email) = lower(NEW.email);
  elsif NEW.role not in ('photographer','recorder') then
    raise exception 'לא ניתן להירשם עם תפקיד זה ללא הזמנה מהמנהל';
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists fl_role_invite_trigger on fl_profiles;
create trigger fl_role_invite_trigger
  before insert on fl_profiles
  for each row execute function fl_apply_role_invite();

-- ============================================================
-- יצירת ההזמנה עבור אפרת - מריצים פעם אחת
-- אם תרצה להזמין מישהו נוסף בעתיד, פשוט משנים את המייל/תפקיד ומריצים שוב
-- ============================================================
insert into fl_role_invites (email, role)
values ('efratn@kan.org.il', 'accountant')
on conflict (email) do update set role = excluded.role;
