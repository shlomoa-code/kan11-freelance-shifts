-- ============================================================
-- הוספת תפקיד "הנהלת חשבונות" - צפייה והדפסה בלבד, ללא יכולת שינוי
-- ============================================================

-- הרחבת רשימת התפקידים המותרים
alter table fl_profiles drop constraint if exists fl_profiles_role_check;
alter table fl_profiles add constraint fl_profiles_role_check
  check (role in ('photographer','recorder','manager','accountant'));

-- פונקציית עזר: האם למשתמש יש גישת צפייה למסך ניהול (מנהל או הנה"ח)
create or replace function fl_has_admin_access() returns boolean as $$
  select exists(select 1 from fl_profiles where id = auth.uid() and role in ('manager','accountant'));
$$ language sql security definer stable;

-- עדכון מדיניות הקריאה (SELECT) - גם הנה"ח יכולה לראות הכל, אבל לא לשנות
drop policy if exists "fl read own or manager reads all" on fl_profiles;
create policy "fl read own or admin reads all" on fl_profiles for select
  using (auth.uid() = id or fl_has_admin_access());

drop policy if exists "fl worker sees own reports, manager sees all" on fl_reports;
create policy "fl worker sees own reports, admin sees all" on fl_reports for select
  using (auth.uid() = worker_id or fl_has_admin_access());

drop policy if exists "fl worker sees own shifts via report, manager sees all" on fl_shifts;
create policy "fl worker sees own shifts via report, admin sees all" on fl_shifts for select
  using (
    exists(select 1 from fl_reports r where r.id = report_id and (r.worker_id = auth.uid() or fl_has_admin_access()))
  );

-- כל שאר הפעולות (אישור, עריכה, מחיקה, תעריפים, גיבוי) נשארות מוגבלות רק ל-fl_is_manager() המקורית - ללא שינוי
