(() => {
  // ====== CONFIGURACIÓN ======
  const VIRTUAL_W = 420;
  const VIRTUAL_H = 740;

  const SCROLL_SPEED_BASE = 160; // px/s
  const SCROLL_SPEED_GAIN = 0.3; // por "moneda"/pez recogido

  // Si ya duplicaste el tamaño del barco en tu proyecto, perfecto.
  // Aquí mantengo los valores por defecto (ajústalos si quieres fijarlo desde el código).
  const BOAT = {
    width: 92,
    height: 156,
    speed: 480, // px/s horizontal
    invulnMs: 1200
  };

  // Ajustados para que se vean más grandes
  const COIN = { radius: 24, spawnEveryMs: 700 }; // antes radius:16
  const OBST = { size: 72, spawnEveryMs: 950 };   // antes size:56

  const WIN_COINS = 10;
  const START_LIVES = 3;

  // Rutas a assets (nombres/caps EXACTOS)
  const ASSETS = {
    water: "assets/water_tile_512.png",
    boat:  "assets/Barco.PNG",
    coin:  "assets/Peces.PNG", // <- peces
    rock:  "assets/Rocas.PNG",  // <- roca
    heart: "assets/heart_32.png"
  };

  // ====== ESTADO ======
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  const hudHearts = document.getElementById('hearts');
  const hudCoins = document.getElementById('coins');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlaySub = document.getElementById('overlay-sub');
  const restartBtn = document.getElementById('restartBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const touchLayer = document.getElementById('touch-layer');

  let DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  // Loader con logs de depuración
  const loadImage = (src) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { console.log("[OK] Cargado", src); res(img); };
    img.onerror = () => { console.warn("[ERROR] No se pudo cargar", src); res(null); };
    img.src = src;
  });

  const images = {};
  let state = {
    running: true,
    time: 0,
    lastTs: 0,
    scroll: 0,
    speed: SCROLL_SPEED_BASE,
    lives: START_LIVES,
    coins: 0,
    invulnUntil: 0,
    boat: { x: VIRTUAL_W/2, y: VIRTUAL_H*0.78, w: BOAT.width, h: BOAT.height },
    pointerX: null,
    entities: { coins: [], obst: [] },
    timers: { coin: 0, obst: 0 },
  };

  function resizeCanvas(){
    const cssW = Math.min(window.innerWidth, 420);
    const cssH = Math.min(window.innerHeight, 740);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(VIRTUAL_W * DPR);
    canvas.height = Math.floor(VIRTUAL_H * DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }

  // ====== UTIL ======
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));

  function aabb(a,b){
    return Math.abs(a.x - b.x) * 2 < (a.w + b.w) && Math.abs(a.y - b.y) * 2 < (a.h + b.h);
  }

  function circleRectCollision(cx, cy, cr, rx, ry, rw, rh){
    const closestX = clamp(cx, rx - rw/2, rx + rw/2);
    const closestY = clamp(cy, ry - rh/2, ry + rh/2);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return (dx*dx + dy*dy) <= cr*cr;
  }

  function updateHUD(){
    hudHearts.textContent = '❤️'.repeat(state.lives);
    hudCoins.textContent = `🪙 ${state.coins} / ${WIN_COINS}`;
  }

  function hideOverlay(){
    // Usamos clase .show controlada por CSS: #overlay {display:none} / #overlay.show {display:grid}
    overlay.classList.remove('show');
  }

  // ====== INPUT ======
  let keys = new Set();
  window.addEventListener('keydown', e=>{
    if (['ArrowLeft','ArrowRight','a','d','A','D'].includes(e.key)) keys.add(e.key.toLowerCase());
    if (e.key === ' '){ togglePause(); }
  });
  window.addEventListener('keyup', e=>{
    keys.delete(e.key.toLowerCase());
  });

  // Touch / arrastre
  function pointerToLocalX(ev){
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width * VIRTUAL_W;
    return clamp(x, 24, VIRTUAL_W-24);
  }
  touchLayer.addEventListener('pointerdown', ev => { state.pointerX = pointerToLocalX(ev); });
  touchLayer.addEventListener('pointermove', ev => {
    if (ev.buttons === 0 && ev.pointerType !== 'touch' && state.pointerX===null) return;
    state.pointerX = pointerToLocalX(ev);
  });
  touchLayer.addEventListener('pointerup', ()=>{ state.pointerX = null; });
  touchLayer.addEventListener('pointercancel', ()=>{ state.pointerX = null; });
  touchLayer.addEventListener('pointerleave', ()=>{ state.pointerX = null; });

  // ====== SPAWN ======
  function spawnCoin(){ // ahora "pez"
    const x = 24 + Math.random() * (VIRTUAL_W - 48);
    state.entities.coins.push({ x, y: -20, r: COIN.radius, vy: state.speed });
  }
  function spawnObst(){ // roca
    const x = 34 + Math.random() * (VIRTUAL_W - 68);
    const size = OBST.size * (0.9 + Math.random()*0.3);
    state.entities.obst.push({ x, y: -40, w: size, h: size, vy: state.speed * (0.95 + Math.random()*0.2) });
  }

  // ====== UPDATE ======
  function step(dt){
    if (!state.running) return;

    state.time += dt;
    state.timers.coin += dt*1000;
    state.timers.obst += dt*1000;

    state.speed = SCROLL_SPEED_BASE + SCROLL_SPEED_GAIN * state.coins * 12;
    state.scroll = (state.scroll + state.speed * dt) % 512;

    let dir = 0;
    if (keys.has('arrowleft') || keys.has('a')) dir -= 1;
    if (keys.has('arrowright') || keys.has('d')) dir += 1;

    if (state.pointerX != null){
      const dx = state.pointerX - state.boat.x;
      const maxMove = BOAT.speed * dt;
      state.boat.x += clamp(dx, -maxMove, maxMove);
    } else if (dir !== 0){
      state.boat.x += dir * BOAT.speed * dt;
    }

    state.boat.x = clamp(state.boat.x, 28, VIRTUAL_W-28);

    if (state.timers.coin >= COIN.spawnEveryMs){ state.timers.coin = 0; spawnCoin(); }
    if (state.timers.obst >= OBST.spawnEveryMs){ state.timers.obst = 0; spawnObst(); }

    for (const c of state.entities.coins) c.y += state.speed * dt;
    for (const o of state.entities.obst)  o.y += o.vy * dt;

    state.entities.coins = state.entities.coins.filter(c => c.y < VIRTUAL_H + 40);
    state.entities.obst  = state.entities.obst.filter(o => o.y < VIRTUAL_H + 60);

    // Colisiones
    for (let i = state.entities.coins.length - 1; i >= 0; i--){
      const c = state.entities.coins[i];
      if (circleRectCollision(c.x, c.y, c.r, state.boat.x, state.boat.y, state.boat.w, state.boat.h)){
        state.entities.coins.splice(i,1);
        state.coins++;
        updateHUD();
        if (state.coins >= WIN_COINS){ win(); return; }
      }
    }

    if (state.time*1000 > state.invulnUntil){
      for (let i = state.entities.obst.length - 1; i >= 0; i--){
        const o = state.entities.obst[i];
        if (aabb({x: state.boat.x, y: state.boat.y, w: state.boat.w, h: state.boat.h}, o)){
          state.lives--;
          updateHUD();
          state.invulnUntil = state.time*1000 + BOAT.invulnMs;
          o.y += 40;
          if (state.lives <= 0){ gameOver(); return; }
          break;
        }
      }
    }
  }

  // ====== RENDER ======
  function render(){
    // Fondo simple (o tile si tienes agua)
    if (images.water){
      ctx.save();
      ctx.translate(0, (state.scroll % 512) - 512);
      for (let y=-512; y < VIRTUAL_H+512; y+=512){
        for (let x=0; x < VIRTUAL_W; x+=512){
          ctx.drawImage(images.water, x, y, 512, 512);
        }
      }
      ctx.restore();
    } else {
      const g = ctx.createLinearGradient(0,0,0,VIRTUAL_H);
      g.addColorStop(0, '#0ea5e9');
      g.addColorStop(1, '#1d4ed8');
      ctx.fillStyle = g;
      ctx.fillRect(0,0,VIRTUAL_W,VIRTUAL_H);
    }

    // Peces (antes monedas)
    for (const c of state.entities.coins){
      if (images.coin){
        const s = COIN.radius * 2;
        ctx.drawImage(images.coin, c.x - s/2, c.y - s/2, s, s);
      } else {
        // Fallback: círculo dorado si no cargó el PNG
        ctx.beginPath();
        ctx.arc(c.x, c.y, COIN.radius, 0, Math.PI*2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#f59e0b';
        ctx.stroke();
      }
    }

    // Rocas (obstáculos)
    for (const o of state.entities.obst){
      if (images.rock){
        ctx.drawImage(images.rock, o.x - o.w/2, o.y - o.h/2, o.w, o.h);
      } else {
        // Fallback: rectángulo gris
        ctx.fillStyle = '#6b7280';
        ctx.fillRect(o.x - o.w/2, o.y - o.h/2, o.w, o.h);
      }
    }

    // Barco (jugador)
    const blink = (state.time*1000 < state.invulnUntil) && (Math.floor(state.time*10)%2===0);
    if (!blink){
      if (images.boat){
        ctx.drawImage(
          images.boat,
          state.boat.x - state.boat.w/2,
          state.boat.y - state.boat.h/2,
          state.boat.w,
          state.boat.h
        );
      } else {
        // Fallback: rectángulo rojo si no cargó el barco
        ctx.fillStyle = '#e11d48';
        ctx.fillRect(state.boat.x - state.boat.w/2, state.boat.y - state.boat.h/2, state.boat.w, state.boat.h);
      }
    }
  }

  // ====== GAME STATE ======
  function win(){
    state.running = false;
    overlay.classList.add('show');
    overlayTitle.textContent = '¡LO HAS CONSEGUIDO!';
    overlaySub.textContent = 'El quinto número es 3.';
    restartBtn.classList.remove('hidden');
    pauseBtn.textContent = '▶️';
  }

  function gameOver(){
    state.running = false;
    overlay.classList.add('show');
    overlayTitle.textContent = 'Game Over 💥';
    overlaySub.textContent = `Monedas recogidas: ${state.coins}/${WIN_COINS}`;
    restartBtn.classList.remove('hidden');
    pauseBtn.textContent = '▶️';
  }

  function resetGame(){
    hideOverlay();
    restartBtn.classList.add('hidden');
    Object.assign(state, {
      running: true,
      time: 0, lastTs: 0, scroll: 0,
      speed: SCROLL_SPEED_BASE,
      lives: START_LIVES,
      coins: 0,
      invulnUntil: 0,
      boat: { x: VIRTUAL_W/2, y: VIRTUAL_H*0.78, w: BOAT.width, h: BOAT.height },
      pointerX: null,
      entities: { coins: [], obst: [] },
      timers: { coin: 0, obst: 0 },
    });
    updateHUD();
    pauseBtn.textContent = '⏸';
  }

  function togglePause(){
    state.running = !state.running;
    pauseBtn.textContent = state.running ? '⏸' : '▶️';
    if (overlay.classList.contains('show') && state.running){
      hideOverlay();
    }
  }

  // ====== LOOP ======
  function loop(ts){
    if (!state.lastTs) state.lastTs = ts;
    const dt = Math.min(0.05, (ts - state.lastTs) / 1000);
    state.lastTs = ts;
    step(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ====== INIT ======
  async function init(){
    resizeCanvas();
    updateHUD();
    window.addEventListener('resize', resizeCanvas, { passive: true });

    // Si sospechas de caché, descomenta estas dos líneas:
    // ASSETS.coin += "?v=1";
    // ASSETS.rock += "?v=1";

    // Carga con logs
    images.water = await loadImage(ASSETS.water);
    images.boat  = await loadImage(ASSETS.boat);
    images.coin  = await loadImage(ASSETS.coin); // Peces.PNG
    images.rock  = await loadImage(ASSETS.rock); // Roca.PNG

    restartBtn.addEventListener('click', resetGame);
    pauseBtn.addEventListener('click', togglePause);

    requestAnimationFrame(loop);
  }

  init();
})();