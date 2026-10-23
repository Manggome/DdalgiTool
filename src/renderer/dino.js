// 🍓 딸기공룡 달리기 — 오래 걸리는 작업을 기다리는 동안 하는 미니게임 (이스터에그)
// 캐릭터·장애물은 모두 이 파일에서 직접 그린 오리지널 픽셀 아트다.
// 쓰는 쪽: DinoGame.armOffer(convId, isStillBusy) / DinoGame.taskDone(convId, status, title, openResult)
(() => {
  const OFF_KEY = 'ddalgi.dino.off';
  const BEST_KEY = 'ddalgi.dino.best';
  const OFFER_AFTER_MS = 45000; // 이만큼 오래 걸리면 한 판 권한다
  const PX = 3; // 픽셀 하나의 크기

  const PALETTE = {
    G: '#5bbf6a', // 몸
    D: '#2c6e38', // 외곽선
    R: '#f2373f', // 딸기 헬멧
    S: '#ffd34d', // 딸기 씨
    L: '#3fa34d', // 꼭지 잎
    W: '#ffffff',
    K: '#1d1d1d',
    P: '#ff9aa8', // 볼
    B: '#8b5cf6', // 알림 말풍선
    H: '#b8bccb', // 종이 줄
    C: '#d23a3a', // 버그 몸통
  };

  // 딸기 헬멧을 쓴 통통한 공룡 (16x16, 오른쪽을 본다). 다리 두 프레임.
  const DINO_TOP = [
    '......LL.LL.....',
    '.......LLL......',
    '.....RRRRRRR....',
    '....RRSRRRSRR...',
    '....RRRRRSRRRR..',
    '....DGGGGGGGGD..',
    '...DGGGGGWKGGD..',
    '...DGGGGGWKGGGD.',
    '...DGGPGGGGGGGGD',
    '..DGGGGGGGGGDDD.',
    'DDGGGGGGGGGD....',
    '.DGGGGGGGGGGD...',
    '..DGGGGGGGGD....',
    '...DGGDDGGD.....',
  ];
  const DINO_A = [...DINO_TOP, '...DGD...DD.....', '...DD...........'];
  const DINO_B = [...DINO_TOP, '...DD...DGD.....', '.........DD.....'];
  const DINO_DEAD = DINO_A.map((row, i) => (i === 6 || i === 7 ? row.replace('WK', 'KW') : row));

  // 장애물 — 버그 벌레, 기획서 더미(땅), 알림 말풍선(공중)
  const BUG = [
    '..K......K..',
    '...K....K...',
    '....KKKK....',
    '..KCCCCCCK..',
    '.KCCKCCKCCK.',
    'KKCCCCCCCCKK',
    '.KCCKCCKCCK.',
    '..KCCCCCCK..',
    '.K.K.KK.K.K.',
    'K..K....K..K',
  ];
  const PAPERS = [
    '.DDDDDDDDDD.',
    '.DWWWWWWWWD.',
    '.DWHHHHHWWD.',
    '.DWWWWWWWWD.',
    '.DWHHHHHHWD.',
    'DDDDDDDDDDD.',
    'DWWWWWWWWWD.',
    'DWHHHHHWWWD.',
    'DWWWWWWWWWD.',
    'DWHHHHHHWWD.',
    'DWWWWWWWWWD.',
    'DWHHHHWWWWD.',
    'DWWWWWWWWWD.',
    'DDDDDDDDDDD.',
  ];
  const BUBBLE = [
    '..BBBBBBBBBB..',
    '.BBBBBBBBBBBB.',
    'BBBBBBWWBBBBBB',
    'BBBBBBWWBBBBBB',
    'BBBBBBWWBBBBBB',
    'BBBBBBBBBBBBBB',
    'BBBBBBWWBBBBBB',
    '.BBBBBBBBBBBB.',
    '..BBBBBBBBBB..',
    '....BBB.......',
  ];

  const sprites = new Map();
  /** 문자열 픽셀 맵을 오프스크린 캔버스로 한 번만 굽는다. */
  function bake(map) {
    if (sprites.has(map)) return sprites.get(map);
    const c = document.createElement('canvas');
    c.width = map[0].length * PX;
    c.height = map.length * PX;
    const g = c.getContext('2d');
    map.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        g.fillStyle = PALETTE[ch];
        g.fillRect(x * PX, y * PX, PX, PX);
      }),
    );
    sprites.set(map, c);
    return c;
  }

  let offerEl = null;
  let overlay = null;
  let game = null;
  let armed = null; // { convId, timer }
  let doneInfo = null;

  const isOff = () => {
    try {
      return localStorage.getItem(OFF_KEY) === '1';
    } catch {
      return false;
    }
  };

  // ---------- 권유 카드 ----------

  function showOffer() {
    if (offerEl || overlay) return;
    offerEl = document.createElement('div');
    offerEl.className = 'dino-offer';
    const t = document.createElement('div');
    t.className = 'dino-offer-text';
    t.textContent = '🦖 작업이 길어지네요… 기다리는 동안 한 판 하실래요?';
    const row = document.createElement('div');
    row.className = 'dino-offer-row';
    const play = document.createElement('button');
    play.textContent = '한 판 하기';
    play.className = 'dino-btn primary';
    play.addEventListener('click', () => {
      hideOffer();
      open();
    });
    const later = document.createElement('button');
    later.textContent = '괜찮아요';
    later.className = 'dino-btn';
    later.addEventListener('click', hideOffer);
    const never = document.createElement('button');
    never.textContent = '다시 보지 않기';
    never.className = 'dino-btn ghost';
    never.addEventListener('click', () => {
      try {
        localStorage.setItem(OFF_KEY, '1');
      } catch {
        /* noop */
      }
      hideOffer();
    });
    row.append(play, later, never);
    offerEl.append(t, row);
    document.body.append(offerEl);
  }

  function hideOffer() {
    offerEl?.remove();
    offerEl = null;
  }

  /** 작업 시작 때 호출 — 오래 걸리면 한 판 권한다. 같은 작업에 한 번만. */
  function armOffer(convId, isStillBusy) {
    disarm();
    if (isOff()) return;
    const timer = setTimeout(() => {
      if (armed?.timer === timer && isStillBusy()) showOffer();
    }, OFFER_AFTER_MS);
    armed = { convId, timer };
  }

  function disarm() {
    if (armed) clearTimeout(armed.timer);
    armed = null;
  }

  /** 작업이 끝나면 — 권유 카드는 거두고, 게임 중이면 완료 배너를 띄운다. */
  function taskDone(convId, status, title, openResult) {
    if (armed && armed.convId === convId) disarm();
    hideOffer();
    if (!overlay) return;
    doneInfo = { status, title, openResult };
    renderDoneBanner();
  }

  // ---------- 게임 ----------

  function open() {
    if (overlay) return;
    document.activeElement?.blur?.(); // 입력창에 스페이스가 찍히지 않게
    overlay = document.createElement('div');
    overlay.className = 'dino-overlay';
    const panel = document.createElement('div');
    panel.className = 'dino-panel';
    const head = document.createElement('div');
    head.className = 'dino-head';
    const title = document.createElement('div');
    title.className = 'dino-title';
    title.textContent = '🍓 딸기공룡 달리기';
    const hint = document.createElement('div');
    hint.className = 'dino-hint';
    hint.textContent = '스페이스·↑·클릭 = 점프 · 말풍선은 밑으로 피하기 · Esc 닫기';
    const close = document.createElement('button');
    close.className = 'dino-close';
    close.textContent = '✕';
    close.addEventListener('click', closeGame);
    head.append(title, hint, close);
    const banner = document.createElement('div');
    banner.className = 'dino-done hidden';
    const canvas = document.createElement('canvas');
    canvas.className = 'dino-canvas';
    panel.append(head, banner, canvas);
    overlay.append(panel);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeGame();
    });
    canvas.addEventListener('mousedown', () => jump());
    document.body.append(overlay);
    window.addEventListener('keydown', onKey, true);
    startGame(canvas);
    if (doneInfo) renderDoneBanner();
  }

  function closeGame() {
    window.removeEventListener('keydown', onKey, true);
    if (game) cancelAnimationFrame(game.raf);
    game = null;
    overlay?.remove();
    overlay = null;
    doneInfo = null;
  }

  function renderDoneBanner() {
    const b = overlay?.querySelector('.dino-done');
    if (!b || !doneInfo) return;
    b.classList.remove('hidden');
    b.classList.toggle('fail', doneInfo.status !== 'ok');
    b.replaceChildren();
    const t = document.createElement('span');
    t.textContent =
      (doneInfo.status === 'ok' ? '✅ 작업 완료' : doneInfo.status === 'stopped' ? '⏹ 작업 중지' : '⚠️ 작업 오류') +
      (doneInfo.title ? ` — ${doneInfo.title}` : '');
    const go = document.createElement('button');
    go.className = 'dino-btn primary';
    go.textContent = '결과 보기';
    go.addEventListener('click', () => {
      const fn = doneInfo?.openResult;
      closeGame();
      fn?.();
    });
    b.append(t, go);
  }

  function onKey(e) {
    if (!overlay) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeGame();
      return;
    }
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      e.stopPropagation();
      jump();
    }
  }

  function startGame(canvas) {
    const W = 680;
    const H = 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    // 너비만 지정 — 창이 좁아 줄어들면 높이는 CSS(height:auto)가 비율대로 따라간다
    canvas.style.width = W + 'px';
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.imageSmoothingEnabled = false;
    const cs = getComputedStyle(document.documentElement);
    const ink = cs.getPropertyValue('--text-dim').trim() || '#9aa3bd';
    const faint = cs.getPropertyValue('--text-faint').trim() || '#6b7490';
    let best = 0;
    try {
      best = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      /* noop */
    }
    game = {
      g,
      W,
      H,
      ink,
      faint,
      groundY: H - 34,
      dino: { x: 56, y: 0, vy: 0, w: 16 * PX, h: 16 * PX },
      obs: [],
      clouds: [
        { x: 120, y: 40 },
        { x: 420, y: 62 },
      ],
      speed: 6,
      dist: 0,
      score: 0,
      best,
      nextGap: 60,
      over: false,
      started: false,
      last: performance.now(),
      raf: 0,
      frame: 0,
    };
    game.dino.y = game.groundY - game.dino.h;
    game.raf = requestAnimationFrame(tick);
  }

  function jump() {
    if (!game) return;
    if (game.over) {
      const c = overlay.querySelector('canvas');
      startGame(c);
      game.started = true;
      return;
    }
    game.started = true;
    const d = game.dino;
    if (d.y >= game.groundY - d.h - 0.5) d.vy = -13.2;
  }

  function spawn() {
    const r = Math.random();
    const s = game.score;
    if (s > 250 && r < 0.22) {
      // 공중 알림 말풍선 — 점프하면 부딪힌다, 밑으로 지나가기
      const sp = bake(BUBBLE);
      game.obs.push({ x: game.W + 10, y: game.groundY - game.dino.h - sp.height + 2, sp });
    } else {
      const sp = bake(r < 0.55 ? BUG : PAPERS);
      const pair = s > 400 && Math.random() < 0.3;
      game.obs.push({ x: game.W + 10, y: game.groundY - sp.height, sp });
      if (pair) game.obs.push({ x: game.W + 10 + sp.width + 4, y: game.groundY - sp.height, sp });
    }
    const minGap = Math.max(34, 70 - game.speed * 3);
    game.nextGap = minGap + Math.random() * 60;
  }

  function hit(a, b) {
    const pad = 6;
    return a.x + pad < b.x + b.w - pad && a.x + a.w - pad > b.x + pad && a.y + pad < b.y + b.h - pad && a.y + a.h - pad > b.y + pad;
  }

  function tick(now) {
    if (!game) return;
    const dt = Math.min(2.5, (now - game.last) / 16.67);
    game.last = now;
    game.frame++;
    const { g, W, H, dino } = game;

    if (game.started && !game.over) {
      // 물리
      dino.vy += 0.75 * dt;
      dino.y += dino.vy * dt;
      if (dino.y > game.groundY - dino.h) {
        dino.y = game.groundY - dino.h;
        dino.vy = 0;
      }
      // 이동·생성
      const v = game.speed * dt;
      for (const o of game.obs) o.x -= v;
      game.obs = game.obs.filter((o) => o.x + o.sp.width > -20);
      for (const c of game.clouds) {
        c.x -= v * 0.25;
        if (c.x < -60) {
          c.x = W + Math.random() * 120;
          c.y = 30 + Math.random() * 50;
        }
      }
      game.nextGap -= v / 6;
      if (game.nextGap <= 0) spawn();
      game.dist += v;
      game.score = Math.floor(game.dist / 8);
      game.speed = Math.min(14, 6 + game.score / 260);
      // 충돌
      const box = { x: dino.x, y: dino.y, w: dino.w, h: dino.h };
      for (const o of game.obs) {
        if (hit(box, { x: o.x, y: o.y, w: o.sp.width, h: o.sp.height })) {
          game.over = true;
          if (game.score > game.best) {
            game.best = game.score;
            try {
              localStorage.setItem(BEST_KEY, String(game.best));
            } catch {
              /* noop */
            }
          }
          break;
        }
      }
    }

    // 그리기
    g.clearRect(0, 0, W, H);
    g.fillStyle = game.faint;
    for (const c of game.clouds) {
      g.fillRect(c.x, c.y, 34, 6);
      g.fillRect(c.x + 8, c.y - 6, 18, 6);
    }
    g.fillStyle = game.ink;
    g.fillRect(0, game.groundY, W, 2);
    for (let x = -(game.dist % 40); x < W; x += 40) g.fillRect(x, game.groundY + 8, 10, 2);
    for (const o of game.obs) g.drawImage(o.sp, Math.round(o.x), Math.round(o.y));
    const onGround = dino.y >= game.groundY - dino.h - 0.5;
    const pose = game.over ? DINO_DEAD : !game.started || !onGround ? DINO_A : Math.floor(game.frame / 6) % 2 ? DINO_A : DINO_B;
    g.drawImage(bake(pose), dino.x, Math.round(dino.y));

    g.fillStyle = game.ink;
    g.font = '600 13px ui-monospace, Menlo, monospace';
    g.textAlign = 'right';
    g.fillText(`최고 ${String(game.best).padStart(5, '0')}   ${String(game.score).padStart(5, '0')}`, W - 12, 22);
    g.textAlign = 'center';
    if (!game.started) {
      g.fillText('스페이스나 클릭으로 시작!', W / 2, 70);
    } else if (game.over) {
      g.fillText('앗, 버그에 걸렸다! — 스페이스로 다시', W / 2, 70);
    }
    game.raf = requestAnimationFrame(tick);
  }

  window.DinoGame = { armOffer, taskDone, open, close: closeGame, offerNow: showOffer };
})();
