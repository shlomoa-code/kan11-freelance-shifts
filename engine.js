// מנוע חישוב שכר לצלמים/מקליטים פרילנס - כאן 11
// rate = base_hourly * MAX(overtime_tier_pct, time_of_day_pct)  (לא מצטבר, רק המקסימום)

function getDayOfWeek(year, month, day) {
  // 0=ראשון ... 6=שבת
  return new Date(year, month - 1, day).getDay();
}

function calcShift({ role, year, month, dayOfMonth, dayType, startTime, endTime, km, extraEquipment, season }, rates) {
  const dow = getDayOfWeek(year, month, dayOfMonth);
  const isFriday = dow === 5;
  const isSaturday = dow === 6;

  const baseHourly = role === 'photographer' ? rates.photographer_daily / 10 : rates.recorder_daily / 10;
  const entryHour = season === 'summer' ? rates.entry_hour_summer : rates.entry_hour_winter;
  const exitHour = season === 'summer' ? rates.exit_hour_summer : rates.exit_hour_winter;

  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let startHour = sh + sm / 60;
  let endHour = eh + em / 60;
  if (endHour <= startHour) endHour += 24; // חוצה חצות

  const totalHours = endHour - startHour;
  let hoursPay = 0;
  const breakdown = [];

  for (let h = 0; h < Math.ceil(totalHours - 1e-9); h++) {
    const hourStart = startHour + h;
    const clockHour = hourStart % 24;
    const fraction = Math.min(1, totalHours - h);

    const shiftHourIndex = h + 1;
    let tierPct = 100;
    if (shiftHourIndex >= 11 && shiftHourIndex <= 12) tierPct = rates.tier1_pct;
    else if (shiftHourIndex >= 13) tierPct = rates.tier2_pct;

    let todPct = 100;
    const isNight = clockHour >= 22 || clockHour < 6;
    if (isNight) todPct = Math.max(todPct, rates.night_pct);

    if (dayType === 'election') {
      if (clockHour >= 7 && clockHour < 22) todPct = Math.max(todPct, rates.election_pct);
    } else {
      if (isSaturday || dayType === 'chag') {
        if (clockHour < exitHour) todPct = Math.max(todPct, rates.chag_shabbat_pct);
      }
      if (isFriday || dayType === 'chag_eve') {
        if (clockHour >= entryHour) todPct = Math.max(todPct, rates.chag_shabbat_pct);
      }
    }

    const finalPct = Math.max(tierPct, todPct);
    const hourPay = baseHourly * (finalPct / 100) * fraction;
    hoursPay += hourPay;
    breakdown.push({ shiftHourIndex, clockHour, tierPct, todPct, finalPct, fraction, hourPay: round2(hourPay) });
  }

  let equipmentBonus = 0;
  if (role === 'photographer' && extraEquipment) equipmentBonus = rates.camera_bonus;
  if (role === 'recorder' && extraEquipment) equipmentBonus = rates.wireless_bonus * Math.min(rates.wireless_max, extraEquipment);

  let kmPay = 0;
  if (role === 'photographer' && km > rates.km_free) kmPay = (km - rates.km_free) * rates.km_rate;

  const beforeVat = round2(hoursPay + equipmentBonus + kmPay);
  const vat = round2(beforeVat * (rates.vat_percent / 100));
  const afterVat = round2(beforeVat + vat);

  return { breakdown, hoursPay: round2(hoursPay), equipmentBonus, kmPay, beforeVat, vat, afterVat, totalHours: round2(totalHours), isFriday, isSaturday };
}

function round2(n) { return Math.round(n * 100) / 100; }
