-- ============================================================
-- הגנת מידע: מחיקה רכה (Soft Delete) + טבלת גיבויים
-- שום שורה לא נמחקת בפועל מבסיס הנתונים לעולם
-- ============================================================

-- הוספת עמודת "נמחק" (במקום מחיקה אמיתית) לטבלאות המשמרות והדוחות
alter table fl_shifts add column if not exists is_deleted boolean not null default false;
alter table fl_reports add column if not exists is_deleted boolean not null default false;

-- ביטול מוחלט של האפשרות למחוק שורות בפועל (הגנה ברמת בסיס הנתונים)
drop policy if exists "fl worker deletes shifts in own open reports" on fl_shifts;
drop policy if exists "fl manager deletes any shift" on fl_shifts;
drop policy if exists "fl worker deletes own open reports" on fl_reports;

-- טבלת גיבויים מלאים
create table if not exists fl_backups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references fl_profiles(id),
  data jsonb not null
);
alter table fl_backups enable row level security;

create policy "fl manager reads backups" on fl_backups for select
  using (fl_is_manager());
create policy "fl manager creates backups" on fl_backups for insert
  with check (fl_is_manager());
