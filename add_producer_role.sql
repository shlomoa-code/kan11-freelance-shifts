-- ============================================================
-- הוספת תפקיד "מפיק" - אותם כללי חישוב, תעריף בסיס נפרד
-- ============================================================

-- הרחבת רשימת התפקידים המותרים
alter table fl_profiles drop constraint if exists fl_profiles_role_check;
alter table fl_profiles add constraint fl_profiles_role_check
  check (role in ('photographer','recorder','manager','accountant','producer'));

-- תעריף יומי בסיס למפיק (1,200 ₪ ל-10 שעות, ניתן לעריכה בהמשך במסך התעריפים)
alter table fl_rate_settings add column if not exists producer_daily numeric not null default 1200;

-- עדכון הטריגר: מפיק הוא תפקיד לגיטימי להרשמה עצמית (לא רק דרך הזמנה, כמו צלם/מקליט)
create or replace function fl_apply_role_invite() returns trigger as $$
declare
  invite record;
begin
  select * into invite from fl_role_invites where lower(email) = lower(NEW.email) limit 1;
  if invite is not null then
    NEW.role := invite.role;
    delete from fl_role_invites where lower(email) = lower(NEW.email);
  elsif NEW.role not in ('photographer','recorder','producer') then
    raise exception 'לא ניתן להירשם עם תפקיד זה ללא הזמנה מהמנהל';
  end if;
  return NEW;
end;
$$ language plpgsql security definer;
