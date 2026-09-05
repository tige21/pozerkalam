/* Скриптовый «ученик»: читает карточку #coach и делает только то, что она показывает.
   Тест методики, не физики: демо доказывает решаемость геометрии, ученик — что карточка
   (текст + пиктограмма руля + бейдж передачи + чип цели) доводит новичка до цели.
   Запуск в консоли страницы:
     const stop = learnerStart();   // вернёт функцию остановки
   Карточку читает структурно, как её видит игрок: .cm — команда (стоп-слова ищутся ТОЛЬКО
   здесь — чип «стоп у голубой линии» описывает ориентир, а не велит тормозить, и раньше
   ученик стоял на старте L8 до таймаута), .cw — пиктограмма руля, .cgear — целевая
   передача, .cg — чип цели (класс done = «цель достигнута», по нему выравнивается частичный
   руль в городских поворотах; числа «цель X° · сейчас Y°» — за 10° до цели ползём;
   слова «стоп/линии/вровень» в чипе — подъезжать медленно). Панель тоже читает: «угол к цели»
   (#angVal) и зазоры — для «доверни и подровняйся», где карточка называет цель, но не руль.
   Правила новичка, которых нет в тексте, но без них текст не работает: задним ходом только
   ползком и руль крутить СТОЯ до упора (демо делает так же: на ходу выравнивание руля из
   упора добавляет ~20° дуги, и 45° превращаются в 65° с кормой в бордюре); после касания —
   стоп, и если касания повторяются, отползти в обратную сторону на полметра.
   «Смотрит по сторонам» только там, где текст велит пропустить: положение статистов —
   это взгляд в зеркало, а не подсказка.
   Способности: газ/тормоз/руль, селектор АКПП (Enter/P), поворотники Q/E, ручник J,
   МКПП (сцепление, первая передача, завод Y после заглоха). */
function learnerStart(){
  const press=(k,on)=>{ input[k]=on; };
  const tapKey=(code)=>pressKey(code);
  const card=document.getElementById('coach'), angEl=document.getElementById('angVal');
  let key='', tPhase=0, partialDone=false, recover=null, steerErr=0, hitStreak=0, alignFwd=null, zoneAhead=null, nudge={dir:0,t:-99};
  const dbg=(b)=>{ window.learnerLast={branch:b, t:+game.t.toFixed(1)}; };

  const read=()=>{
    const q=s=>card.querySelector(s);
    const cm=q('.cm'), cw=q('.cw'), cg=q('.cgear'), chip=q('.cg');
    const full=card.textContent.replace(/\s+/g,' ').trim();
    const txt=cm ? cm.textContent.trim() : full;
    let wheel=null;
    if(cw) for(const w of ['lockL','lockR','left','right','straight']) if(cw.classList.contains(w)) wheel=w;
    const goalText=chip ? chip.textContent : '';
    const mt=/цель\s*(-?\d+)°/.exec(goalText), mc=/сейчас\s*(-?\d+)°/.exec(goalText);
    return { txt, full, wheel, phaseCard: !!cm, gear: cg ? cg.textContent.trim() : null, goalText,
             goalDone: !!(chip && chip.classList.contains('done')),
             angLeft: (mt&&mc) ? Math.abs(+mt[1]-+mc[1]) : null };
  };
  /* «угол к цели» с панели: «40° вправо» — нос правее оси цели (+), «влево» — левее (−) */
  const readAng=()=>{
    const t=angEl ? angEl.textContent : '';
    if(/ровно/i.test(t)) return 0;
    const m=/(\d+)°\s*(вправо|влево)/.exec(t);
    return m ? (m[2]==='влево'?-1:1)*(+m[1]) : null;
  };
  /* dir: -1 влево, +1 вправо; frac — доля полного руля. Смотреть на руль — не читерство */
  const steerTo=(dir,frac)=>{
    const err=dir*frac*CAR.maxSteer - car.steer; steerErr=Math.abs(err);
    press('left', err<-rad(1.5)); press('right', err>rad(1.5)); press('center',false);
  };
  const center=()=>{ steerErr=Math.abs(car.steer); press('left',false); press('right',false); press('center',true); };
  const hands=()=>{ steerErr=0; press('left',false); press('right',false); press('center',false); };
  const brake=()=>{ press('fwd',false); press('back',true); };
  const drive=(lim)=>{
    /* без мёртвой зоны: на уклоне «ни газа ни тормоза» превращается в откат */
    const back = car.gear>=0 ? car.vel>lim : car.vel<-lim;
    press('back',back); press('fwd',!back);
  };
  const aimZone=(aheadForced)=>{
    const c0=bodyPos(), g=level.goal, f=fuv(g.th), back=car.gear<0;
    const ahead=aheadForced!==undefined ? aheadForced : Math.abs(angNorm(Math.atan2(g.u-c0.u, g.v-c0.v)-car.th))<rad(90);
    const k=ahead?1.5:-1.5, tu=g.u+f.u*k, tv=g.v+f.v*k;
    const err=angNorm(Math.atan2(tu-c0.u, tv-c0.v)-car.th), e=back?-err:err;
    /* усиление e/12° с потолком 0,8 руля: после поворота до зоны 6 м, а сместиться надо на метр */
    if(Math.abs(e)<rad(2)) center(); else steerTo(e>0?1:-1, Math.min(0.8, Math.abs(e)/rad(12)));
  };
  const actorNear=()=>{
    const c=bodyPos();
    return level.actors.some(a=> a.act.started && !a.act.done && Math.hypot(a.u-c.u, a.v-c.v)<18);
  };

  const goRe=/газ|вперёд|веди|подъезжай|наверх|едь|прямо до|трогайся|сдай назад|назад до|медленно назад|назад с|плавно вверх|по настилу|скатывайся|спуск|вкатись|подай вперёд|глубже|поворачивай|направо|налево|по дуге|проезжай|доезжай|выезжай|выходи|разгоняйся|прижмись|к зоне|до зоны|до угла|доводи|к перекрёстку|к переходу|по прямой|по своей полосе|по полосе/i;
  const stopRe=/тормози|остановись|останови машину|стоп[,! —]|стоп у|замри|полностью остановись/i;
  const waitRe=/пропусти|пропускай|стой и|жди|уступи/i;
  const slowRe=/крип|плавно|полз|медленн|5–7|сбавь|малой дуге/i;
  const hitRe=/^⚠|задел/i;
  const alignRe=/доверни|подровняй|выровняйся параллельно|выровняй машину|качай/i;
  const revWords=/назад|задним ходом|включи R|включи задний/i;

  const tick=setInterval(()=>{
    if(paused || game.done){ for(const k of ['fwd','back','left','right','center']) press(k,false); return; }
    const c=read(); let txt=c.txt;
    /* карточки goalMiss/P-заметки дописывают «Дальше: <действие фазы>» — команда именно там
       (goalMiss кладёт всю фразу в .cm, поэтому без оглядки на тип карточки) */
    let pre='';
    { const m=/^(.*?)Дальше:\s*(.+)$/.exec(txt); if(m){ pre=m[1]; txt=m[2].trim(); } }
    const k=txt+'|'+c.wheel+'|'+c.gear;
    if(k!==key){ key=k; tPhase=0; partialDone=false; if(hitRe.test(txt)) hitStreak++; else if(c.phaseCard) hitStreak=0; }
    else tPhase+=0.1;
    /* ⚙-уведомления (toast) — не команды: газ/тормоз оставляем, руль — прямо. Зажатая клавиша
       разворачивала машину на 180°, а «отпущенный» руль на 3 с тоста уводил с маршрута дугой */
    if(c.full.startsWith('⚙')){ center(); if(Math.abs(car.vel)>1.9) brake(); return; }
    const stopped=Math.abs(car.vel)<0.1;

    /* отъезд после касания: сменить направление и отползти на полметра, дальше снова по карточке */
    if(recover){
      dbg('recover'); recover.t+=0.1;
      if(car.sel!==recover.sel){ hands(); brake(); if(recover.t>0.4 && stopped) tapKey('Enter'); return; }
      if(recover.t<recover.until){ if(recover.dir) steerTo(recover.dir,0.5); else hands(); drive(0.6); return; }
      recover=null; hitStreak=0;
    }
    if(hitRe.test(txt)){
      dbg('hit'); hands(); brake();
      /* куда отъезжать, говорит сам текст: задел кормой — вперёд, носом — назад; руль от стены */
      if((tPhase>1.5 || hitStreak>=2) && stopped){
        const sel = /задн/i.test(txt) ? 'D' : /передн/i.test(txt) ? 'R' : (car.sel==='R'?'D':'R');
        const dir = /прав/i.test(txt) ? -1 : /лев/i.test(txt) ? 1 : 0;
        recover={sel, dir, t:0, until:1.6};
      }
      return;
    }

    /* «доверни и подровняйся»: карточка называет цель, руль и направление — с панели.
       Едем туда, где больше места; руль против знака угла вперёд, по знаку — назад */
    /* «доверни и подровняйся. Дальше: останови в зоне» — доворот важнее «останови»: стоя в центре зоны
       под 22° прицел в зону только щёлкал D/R, а угол правит доворот по панели */
    if((alignRe.test(txt) || alignRe.test(pre)) && !c.wheel && !c.gear && !mtOn()){
      const a=readAng();
      if(a!==null){
        dbg('align');
        if(Math.abs(a)<4){ center(); brake(); alignFwd=null; return; }
        /* короткие ходы туда, где есть место: направление липкое, меняется, когда упёрлись */
        const fr=lastClear.front, re=lastClear.rear;
        if(revWords.test(txt)) alignFwd=false; else if(/вперёд/i.test(txt)) alignFwd=true;
        else if(alignFwd===null) alignFwd = fr>=re;
        else if(alignFwd && fr<0.15 && re>fr) alignFwd=false;
        else if(!alignFwd && re<0.15 && fr>re) alignFwd=true;
        const needSel = alignFwd ? 'D' : 'R';
        const dir = (a>0 ? -1 : 1) * (alignFwd ? 1 : -1);
        /* руль крутим на ходу: ждать упора стоя — 3,6 с на каждый 15-сантиметровый ход, и 120 с не хватало */
        steerTo(dir,0.85);
        if(car.sel!==needSel){ brake(); if(tPhase>0.4 && stopped) tapKey('Enter'); return; }
        if((alignFwd && fr<0.12) || (!alignFwd && re<0.12)){ brake(); return; }
        drive(0.5); return;
      }
    } else alignFwd=null;

    const wantStop=stopRe.test(txt) && !/трогайся|газ —/i.test(txt);
    /* «останови в зоне», а до зоны ещё больше метра (goalMiss молчит): не P и не стоп, а докатиться
       ползком по оси зоны. Рядом с зоной — честно тормозим: стоя карточка сменится на goalMiss с
       адресным советом (доверни / подай вперёд), и каждый такой ход двигает позу к зачёту */
    const toZone = wantStop && /зон[а-яё]*/i.test(txt) && level.goal && !goalPoseOk() && goalMiss()==='';
    if(!toZone) zoneAhead=null;
    const wantWait=!wantStop && waitRe.test(txt);
    const wantGo=!wantStop && !wantWait && (goRe.test(txt) || c.gear==='D' || c.gear==='R');

    /* МКПП-рефлексы — раньше всего: заглох лечится, передача включается.
       Правило новичка: сцепление ВЫЖАТО всегда, кроме движения с включённой
       передачей — стоянка на передаче с отпущенным глохнет каждые полсекунды */
    if(mtOn()){
      if(car.stalled){ press('clutch',true); if(tPhase>0.3) tapKey('KeyY'); return; }
      if(wantGo && car.mgear===0){
        press('clutch',true);
        if(car.clu>0.9) mtShift(1);
        return;
      }
      press('clutch', !(wantGo && car.mgear!==0));
    }

    /* поворотники: включаем названный, если ещё не горит */
    if(/правый поворотник|поворотник \(E\)/i.test(c.full) && car.blink!=='R') tapKey('KeyE');
    if(/левый поворотник|поворотник \(Q\)/i.test(c.full) && car.blink!=='L') tapKey('KeyQ');

    /* ручник: «затяни» / «снимай» */
    if(/затяни ручник/i.test(txt) && !car.hand) tapKey('KeyJ');
    /* снимаем под газом: с затянутым ручником скорость не вырастет — гейт по input.fwd */
    if(/снимай ручник|сними ручник/i.test(txt) && car.hand && (input.fwd || Math.abs(car.vel)>0.05)) tapKey('KeyJ');

    /* руль: пиктограмма важнее текста. Считаем раньше селектора: руль крутим и пока стоим */
    if(c.wheel==='lockL') steerTo(-1,1);
    else if(c.wheel==='lockR') steerTo(1,1);
    /* «руль прямо» + «к зоне»: прямо — это дефолт, цель — зона; после разворота она на метр в стороне */
    else if(c.wheel==='straight' && /зон[а-яё]*/i.test(txt) && level.goal) aimZone();
    else if(c.wheel==='straight') center();
    else if(c.wheel==='left' || c.wheel==='right'){
      /* частичный руль: держим до отметки «цель достигнута» на чипе, потом выравниваем */
      if(c.goalDone) partialDone=true;
      /* городские повороты — в упор: радиус на 0,6 руля (~7 м) уводил из полосы на 1,5 м вбок,
         и до зоны оставалось шаффлить по сантиметру; чип «цель достигнута» сам выравнивает руль */
      if(partialDone) center(); else steerTo(c.wheel==='left'?-1:1, 1);
    }
    else if(/руль ВЛЕВО|влево до упора|полный левый/i.test(txt)) steerTo(-1,1);
    else if(/руль ВПРАВО|вправо до упора|полный правый/i.test(txt)) steerTo(1,1);
    else if(/зон[а-яё]*/i.test(txt) && level.goal) aimZone();   /* «прямо до зоны» — сначала зона, потом «прямо» */
    else if(/руль прямо|выровняй руль|выравнивай руль|руль ПРЯМО|по прямой|^прямо/i.test(txt)) center();
    /* «забирая левее/правее» на карточке goalMiss — руль держим в ту сторону весь ход: вперёд-назад
       с одним и тем же рулём сдвигает машину вбок (шаффл), а «доворот и обратно» лишь качал её на месте.
       «Прижмись правее» на ходу — короткий доворот и обратно: смещение на полполосы */
    else if(/правее|левее|к осевой/i.test(txt)){
      const dir=/правее/i.test(txt)?1:-1;
      if(c.full.startsWith('◎')) steerTo(dir,0.6);
      else {
        /* смещение — один раз на 8 с: фазы «прижмись правее» и «до перекрёстка» чередуются на границе
           u, и каждое возвращение текста перезапускало доворот — машина уходила на 45° в поперечную улицу */
        if(nudge.dir!==dir || game.t-nudge.t>8){ nudge={dir, t:game.t}; }
        const dt=game.t-nudge.t;
        if(dt<1.2) steerTo(dir,0.6); else if(dt<2.4) steerTo(-dir,0.6); else center();
      }
    }
    else hands();

    /* селектор АКПП: бейдж карточки — целевая передача; переключение только стоя и с тормозом,
       поэтому пока едем не туда — сначала тормозим. «Назад до угла 0°» без бейджа — тоже R:
       иначе «Дальше: … назад …» на карточке goalMiss читалось как «ехать» и включало D в кармане */
    if(!mtOn()){
      /* явные фразы про селектор ищем во всей карточке: P-заметка «включи передачу … Дальше: …»
         после вырезания «Дальше» теряла собственную команду и ученик сидел в P */
      const wantR = c.gear==='R' || (c.gear!=='D' && revWords.test(txt)) || /включи R|включи задний/i.test(c.full);
      /* из P в D не лезем, если дальше велено стоять: «останови в зоне + P» → P → P-заметка
         «включи передачу … Дальше: останови» → D → … — ученик щёлкал P/D по кругу */
      /* toZone сам выбирает D/R по положению зоны; здесь только вывод из P */
      const wantD = !wantR && (c.gear==='D' || (toZone && car.sel==='P')
        || (!wantStop && (/включи передачу|включи D|тапни D/i.test(c.full) || (wantGo && !revWords.test(txt)))));
      if(wantR && car.sel!=='R'){ dbg('shiftR'); brake(); if(tPhase>0.4 && stopped) tapKey('Enter'); return; }
      if(wantD && car.sel!=='D'){ dbg('shiftD'); brake(); if(tPhase>0.4 && (car.sel==='P' || stopped)) tapKey('Enter'); return; }
      const wantP=!toZone && (/включи P/i.test(txt) || (wantStop && /\+ ?P\b/.test(c.goalText)));
      if(wantP && car.sel!=='P' && stopped){ dbg('shiftP'); brake(); if(tPhase>0.6) tapKey('KeyP'); return; }
    }

    /* продольное: стоп-слова сильнее газа; «пропусти» — стоим, пока статист рядом.
       Задний ход — только ползком, руль в упор/из упора докручиваем стоя; к стоп-линии и
       за 10° до цели угла — ползком */
    /* «останови в зоне», а зоны под колёсами нет (goalMiss молчит — до неё больше метра):
       подкатываемся к ней ползком, целясь по оси, и только потом тормозим */
    if(toZone){
      dbg('toZone');
      const c0=bodyPos(), g=level.goal, rel=Math.abs(angNorm(Math.atan2(g.u-c0.u, g.v-c0.v)-car.th));
      if(zoneAhead===null || rel<rad(75) || rel>rad(105)) zoneAhead = rel<rad(90);
      aimZone(zoneAhead);
      const needSel=zoneAhead?'D':'R';
      if(car.sel!==needSel){ brake(); if(tPhase>0.4 && stopped) tapKey('Enter'); return; }
      drive(1.2); return;
    }
    if(wantStop){ dbg('stop'); brake(); }
    else if(wantWait){ dbg('wait'); const near=actorNear(); press('fwd',!near); press('back',near); }
    /* «в зелёную зону» без слова «остановись»: в зоне — стоп, рядом с ней — ползком.
       Зона нарисована на асфальте, игрок видит, что уже в ней; ученик без этого ехал сквозь неё в стену */
    else if(wantGo && /зон[а-яё]*/i.test(txt) && level.goal && goalPoseOk()){ dbg('inZone'); center(); brake(); }
    else if(wantGo){
      const slow=slowRe.test(txt), approach=/стоп|лини|вровень|перекрёст|переход/i.test(c.goalText+' '+txt);
      const zoneDist = (/зон[а-яё]*/i.test(txt) && level.goal) ? Math.hypot(level.goal.u-bodyPos().u, level.goal.v-bodyPos().v) : 1e9;
      const nearZone = zoneDist<8;   /* с 3,4 м/с тормозной путь ~1,5 м — на зону 5,6 м проскакивали насквозь */
      /* руль «до упора» в D тоже крутим стоя: на 3,4 м/с за 0,9 с намотки машина уезжала на 3 м
         вглубь перекрёстка, и разворот упирался в границу уровня */
      const parking = car.sel==='R' || slow || c.wheel==='lockL' || c.wheel==='lockR';
      if(parking && steerErr>rad(2)){ dbg('turnStanding'); brake(); return; }
      const turning = !!c.wheel && c.wheel!=='straight';
      let lim = car.sel==='R' ? (slow?1.2:1.6) : ((slow||approach||turning)?1.9:3.4);
      if(nearZone) lim=Math.min(lim, zoneDist<4 ? 0.8 : 1.4);
      if(c.angLeft!==null && c.angLeft<=10 && !c.goalDone) lim=Math.min(lim,0.7);
      dbg('go'); drive(lim);
    } else { dbg('idle'); press('fwd',false); press('back',false); }
  },100);
  return ()=>{ clearInterval(tick); for(const k in input) input[k]=false; };
}
