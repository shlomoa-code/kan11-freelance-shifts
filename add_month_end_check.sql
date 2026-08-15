-- הוספת הגנה ברמת בסיס הנתונים: אי אפשר לשנות סטטוס ל-'submitted' לפני שהחודש המדווח הסתיים בפועל
create or replace function fl_check_month_ended() returns trigger as $$
begin
  if NEW.status = 'submitted' and OLD.status = 'open' then
    if now() < make_date(NEW.year, NEW.month, 1) + interval '1 month' then
      raise exception 'ניתן להגיש דוח רק לאחר שהחודש המדווח הסתיים';
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists fl_enforce_month_ended on fl_reports;
create trigger fl_enforce_month_ended
  before update on fl_reports
  for each row execute function fl_check_month_ended();
