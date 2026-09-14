#!/usr/bin/env node
/* Показ параллельной парковки на лендинге (landing/src/scripts/park.js) обязан проезжать
   мимо соседей. Траектория там считается тем же кинематическим велосипедом, что и в игре,
   но её никто не сверял с рядом стоящих машин: при остановке «бампер в бампер» вторая дуга
   проводила нос СКВОЗЬ переднюю машину — на главной анимации лендинга это было видно.

   Здесь весь PATH прогоняется против каждой машины ряда и меряется зазор между кузовами.
     node tools/park-path-check.mjs
   Код 1, если есть пересечение или зазор меньше GAP_MIN. */
import { PATH, ROW, corners, CAR_L, CAR_W, POCKET_A, POCKET_B, Y_PARK, START_BACK }
  from '../landing/src/scripts/park.js';

const GAP_MIN = 0.10;          /* 10 см: меньше на картинке читается как касание */

const segDist = (a, b, c, d) => {
  const pd = (p, q, r) => {
    const du = r[0] - q[0], dv = r[1] - q[1], L2 = du * du + dv * dv || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * du + (p[1] - q[1]) * dv) / L2));
    return Math.hypot(p[0] - (q[0] + du * t), p[1] - (q[1] + dv * t));
  };
  return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b));
};
const inside = (p, P) => {
  let w = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++)
    if (((P[i][1] > p[1]) !== (P[j][1] > p[1])) &&
        (p[0] < (P[j][0] - P[i][0]) * (p[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0])) w = !w;
  return w;
};
const polyDist = (P, Q) => {
  for (const p of P) if (inside(p, Q)) return -1;
  for (const q of Q) if (inside(q, P)) return -1;
  let m = 1e9;
  for (let i = 0; i < P.length; i++) for (let j = 0; j < Q.length; j++)
    m = Math.min(m, segDist(P[i], P[(i + 1) % P.length], Q[j], Q[(j + 1) % Q.length]));
  return m;
};

const parked = ROW.map(x => corners({ x, y: Y_PARK, th: 0 }));
const worst = ROW.map(() => ({ d: 1e9, i: -1, phase: -1, th: 0 }));
PATH.forEach((p, i) => {
  const E = corners(p);
  parked.forEach((Q, k) => {
    const d = polyDist(E, Q);
    if (d < worst[k].d) worst[k] = { d, i, phase: p.phase, th: p.th * 180 / Math.PI };
  });
});

let bad = 0;
worst.forEach((w, k) => {
  if (w.d >= GAP_MIN) return;
  bad++;
  console.log(`FAIL · машина ряда #${k}: ${w.d < 0 ? 'ПЕРЕСЕЧЕНИЕ' : (w.d * 100).toFixed(1) + ' см'}` +
              ` на кадре ${w.i} (фаза ${w.phase}, курс ${w.th.toFixed(1)}°)`);
});
const mn = Math.min(...worst.map(w => w.d));
const end = PATH[PATH.length - 1];
console.log(`карман ${(POCKET_A - POCKET_B).toFixed(1)} м · кузов ${CAR_L}×${CAR_W} · старт на ${START_BACK} м позади соседа`);
console.log(`худший зазор за показ: ${mn < 0 ? 'ПЕРЕСЕЧЕНИЕ' : (mn * 100).toFixed(1) + ' см'}` +
            ` · встал y=${end.y.toFixed(2)} (бордюр ${Y_PARK}) курс ${(end.th * 180 / Math.PI).toFixed(1)}°`);
if (Math.abs(end.y - Y_PARK) > 0.10) { bad++; console.log('FAIL · машина встала не у бордюра'); }
console.log(bad ? `park-path-check: нарушений ${bad}` : 'park-path-check: всё зелено');
process.exit(bad ? 1 : 0);
