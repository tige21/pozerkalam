/* Скриптовый «ученик»: читает карточку #coach и делает только то, что она говорит.
   Тест методики, не физики: демо доказывает решаемость геометрии, ученик — что
   ТЕКСТ подсказок доводит новичка до цели. Запускается в консоли страницы:
     const stop = learnerStart();   // вернёт функцию остановки
   Способности: газ/тормоз/руль по словам, селектор АКПП (Enter/P), поворотники Q/E,
   ручник J, МКПП (сцепление, первая передача, завод Y после заглоха).
   Известный долг (не здесь): эвристики доворота для зеркальных уровней L8/L10,
   словарь «вглубь/приём/крипом» перпендикулярных заездов, городские повороты. */
function learnerStart(){
  const press=(k,on)=>{ input[k]=on; };
  const tapKey=(code)=>pressKey(code);
  let phase='', tPhase=0;
  const tick=setInterval(()=>{
    if(paused || game.done){ for(const k of ['fwd','back','left','right','center']) press(k,false); return; }
    const txt=document.getElementById('coach').textContent;
    if(txt!==phase){ phase=txt; tPhase=0; } else tPhase+=0.1;
    /* ⚙-уведомления (toast) — не команды: продолжаем делать что делали */
    if(txt.trim().startsWith('⚙')) return;
    const goRe=/газ|вперёд|веди|подъезжай|наверх|едь|прямо до|трогайся|сдай назад|назад до|плавно вверх|по настилу|скатывайся|спуск|вкатись|подай вперёд|глубже/i;

    /* МКПП-рефлексы — раньше всего: заглох лечится, передача включается.
       Правило новичка: сцепление ВЫЖАТО всегда, кроме движения с включённой
       передачей — стоянка на передаче с отпущенным глохнет каждые полсекунды */
    if(mtOn()){
      if(car.stalled){ press('clutch',true); if(tPhase>0.3) tapKey('KeyY'); return; }
      const going=goRe.test(txt);
      if(going && car.mgear===0){
        press('clutch',true);
        if(car.clu>0.9) mtShift(1);
        return;
      }
      press('clutch', !(going && car.mgear!==0));
    }

    /* поворотники: включаем названный, если ещё не горит */
    if(/правый поворотник|поворотник \(E\)/i.test(txt) && car.blink!=='R') tapKey('KeyE');
    if(/левый поворотник|поворотник \(Q\)/i.test(txt) && car.blink!=='L') tapKey('KeyQ');

    /* ручник: «затяни» / «снимай» */
    if(/затяни ручник/i.test(txt) && !car.hand) tapKey('KeyJ');
    /* снимаем под газом: с затянутым ручником скорость не вырастет — гейт по input.fwd */
    if(/снимай ручник|сними ручник/i.test(txt) && car.hand && (input.fwd || Math.abs(car.vel)>0.05)) tapKey('KeyJ');

    /* селектор АКПП: из P — с тормозом; R по тексту; P в конце */
    if(!mtOn()){
      if((/включи передачу|включи D|тапни D/i.test(txt) || goRe.test(txt)) && car.sel==='P'){
        press('back',true); if(tPhase>0.4) tapKey('Enter'); return;
      }
      if(/включи R|задним ходом|Включи задний/i.test(txt) && car.sel!=='R' && Math.abs(car.vel)<0.1){
        press('back',true); if(tPhase>0.4) tapKey('Enter'); return;
      }
      if(/включи P/i.test(txt) && car.sel!=='P' && Math.abs(car.vel)<0.1){
        press('back',true); if(tPhase>0.4) tapKey('KeyP'); return;
      }
    }

    /* руль */
    press('left',false); press('right',false); press('center',false);
    if(/руль ВЛЕВО|влево до упора/i.test(txt)) press('left',true);
    else if(/руль ВПРАВО|вправо до упора/i.test(txt)) press('right',true);
    else if(/руль прямо|выровняй руль|руль ПРЯМО/i.test(txt)) press('center',true);

    /* продольное: стоп-слова сильнее газа */
    const wantStop=/тормози|остановись|останови машину|стоп[,! ]|замри/i.test(txt);
    const wantGo=goRe.test(txt);
    if(wantStop && !/трогайся|газ —/i.test(txt)){ press('fwd',false); press('back',true); }
    else if(wantGo){
      const lim=/крип|плавно|полз|медленн|держи 5–7/i.test(txt)?1.9:3.4;
      /* без мёртвой зоны: на уклоне «ни газа ни тормоза» превращается в откат */
      const back = car.gear>=0 ? car.vel>lim : car.vel<-lim;
      press('back',back); press('fwd',!back);
    } else { press('fwd',false); }
  },100);
  return ()=>{ clearInterval(tick); for(const k in input) input[k]=false; };
}
