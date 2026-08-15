-- הרשאות נוספות למנהל: עריכת שם פרילנס, ועריכת/מחיקת כל משמרת (גם אחרי הגשה/אישור)

-- מנהל יכול לעדכן כל פרופיל (בעיקר לתיקון שם כדי שיתאים לסידור העבודה)
create policy "fl manager updates any profile" on fl_profiles for update
  using (fl_is_manager());

-- מנהל יכול לעדכן כל משמרת, לא רק בדוחות פתוחים
create policy "fl manager updates any shift" on fl_shifts for update
  using (fl_is_manager());

-- מנהל יכול למחוק כל משמרת
create policy "fl manager deletes any shift" on fl_shifts for delete
  using (fl_is_manager());
