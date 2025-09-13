(() => {
  // ====== CONFIGURACIÓN ======
  const VIRTUAL_W = 420;
  const VIRTUAL_H = 740;

  const SCROLL_SPEED_BASE = 160; // px/s
  const SCROLL_SPEED_GAIN = 0.3; // por moneda recogida

  const BOAT = {
    width: 46,
    height: 78,
    speed: 480, // px/s horizontal
    invulnMs: 1200
  };

  const COIN = { radius: 16, spawnEveryMs: 700 };
  const OBST = { size: 56, spawnEveryMs: 950 };

  const WIN_COINS = 10;
  const START_LIVES = 3;

  // Opcional: rutas a assets (si existen en /assets). Si faltan, se dibujan formas.
  const ASSETS = {
    water: "assets/water_tile_512.png",
    boat:  "assets/boat_topdown_64x128.png",
    coin:  "assets/coin_48.png",
    rock:  "assets/rock_96.png",
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
  const startBtn = document.getElementById('startBtn');
  const restartBtn = document.getElementById('restartBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const touchLayer = document.getElementById('touch-layer');

  let DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  const loadImage = (src) => new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null); // resolvemos con null para fallback
    img.src = src;
  });

  const images = {};
  let waterPatternEnabled = false;

  const state = {
    running: false,           // empieza pausado hasta pulsar JUGAR
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

  function showOverlay(title, sub, showStart=false, showRestart=false){
    overlay.classList.remove('hidden');
    overlayTitle.textContent = title;
    overlaySub.textContent = sub || "";
    startBtn.classList.toggle('hidden', !showStart);
    restartBtn.classList.toggle('hidden', !showRestart);
  }
  function hideOverlay(){ overlay.classList.add('hidden'); }

  // ====== INPUT ======
  let keys = new Set();
  window.addEventListener('keydown', e=>{
    const k = e.key.toLowerCase();
    if (['arrowleft','arrowright','a','d'].includes(k)) keys.add(k);
    if (e.key === ' ') togglePause();
  });
  window.addEventListener('keyup', e=>{
    keys.delete(e.key.toLowerCase());
  });

  function pointerToLocalX(ev){
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width * VIRTUAL_W;
    return clamp(x, 24, VIRTUAL_W-24);
  }
  const onPointerDown = (ev)=>{ state.pointerX = pointerToLocalX(ev); };
  const onPointerMove = (ev)=>{
    if (ev.buttons === 0 && ev.pointerType !== 'touch' && state.pointerX===null) return;
    state.pointerX = pointerToLocalX(ev);
  };
  const onPointerUp = ()=>{ state.pointerX = null; };

  touchLayer.addEventListener('pointerdown', onPointerDown);
  touchLayer.addEventListener('pointermove', onPointerMove);
  touchLayer.addEventListener('pointerup', onPointerUp);
  touchLayer.addEventListener('pointercancel', onPointerUp);
  touchLayer.addEventListener('pointerleave', onPointerUp);

  // ====== SPAWN ======
  function spawnCoin(){
    const x = 24 + Math.random() * (VIRTUAL_W - 48);
    state.entities.coins.push({ x, y: -20, r: COIN.radius, vy: state.speed });
  }
  function spawnObst(){
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

    // teclado
    let dir = 0;
    if (keys.has('arrowleft') || keys.has('a')) dir -= 1;
    if (keys.has('arrowright') || keys.has('d')) dir += 1;

    // puntero
    if (state.pointerX != null){
      const dx = state.pointerX - state.boat.x;
      const maxMove = BOAT.speed * dt;
      state.boat.x += clamp(dx, -maxMove, maxMove);
    } else if (dir !== 0){
      state.boat.x += dir * BOAT.speed * dt;
    }
    state.boat.x = clamp(state.boat.x, 28, VIRTUAL_W-28);

    // spawns
    if (state.timers.coin >= COIN.spawnEveryMs){
      state.timers.coin = 0;
      spawnCoin();
    }
    if (state.timers.obst >= OBST.spawnEveryMs){
      state.timers.obst = 0;
      spawnObst();
    }

    // mover entidades
    for (const c of state.entities.coins) c.y += state.speed * dt;
    for (const o of state.entities.obst)  o.y += o.vy * dt;

    // limpiar fuera de pantalla
    state.entities.coins = state.entities.coins.filter(c => c.y < VIRTUAL_H + 40);
    state.entities.obst  = state.entities.obst.filter(o => o.y < VIRTUAL_H + 60);

    // Colisiones
    // Coins
    for (let i = state.entities.coins.length - 1; i >= 0; i--){
      const c = state.entities.coins[i];
      if (circleRectCollision(c.x, c.y, c.r, state.boat.x, state.boat.y, state.boat.w, state.boat.h)){
        state.entities.coins.splice(i,1);
        state.coins++;
        updateHUD();
        if (state.coins >= WIN_COINS){
          win();
          return;
        }
      }
    }

    // Obstáculos
    if (state.time*1000 > state.invulnUntil){
      for (let i = state.entities.obst.length - 1; i >= 0; i--){
        const o = state.entities.obst[i];
        if (aabb({x: state.boat.x, y: state.boat.y, w: state.boat.w, h: state.boat.h}, o)){
          state.lives--;
          updateHUD();
          state.invulnUntil = state.time*1000 + BOAT.invulnMs;
          if (state.lives <= 0){
            gameOver();
            return;
          }
          break;
        }
      }
    }
  }

  // ====== RENDER ======
  function render(){
    // Fondo agua
    if (images.water){
      const scrollY = (state.scroll % 512);
      ctx.save();
      ctx.translate(0, -scrollY);
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

      ctx.globalAlpha = 0.08;
      for (let y = -40 + (state.scroll % 40); y < VIRTUAL_H + 40; y+=40){
        ctx.beginPath();
        for (let x=0; x<=VIRTUAL_W; x+=20){
          const yy = y + Math.sin((x + state.scroll)*0.04)*6;
          if (x===0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Monedas
    for (const c of state.entities.coins){
      if (images.coin){
        const s = COIN.radius*2;
        ctx.drawImage(images.coin, c.x - s/2, c.y - s/2, s, s);
      } else {
        ctx.beginPath();
        ctx.arc(c.x, c.y, COIN.radius, 0, Math.PI*2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#f59e0b';
        ctx.stroke();
      }
    }

    // Obstáculos
    for (const o of state.entities.obst){
      if (images.rock){
        ctx.drawImage(images.rock, o.x - o.w/2, o.y - o.h/2, o.w, o.h);
      } else {
        ctx.fillStyle = '#6b7280';
        ctx.beginPath();
        roundRect(ctx, o.x - o.w/2, o.y - o.h/2, o.w, o.h, 10);
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#4b5563';
        ctx.stroke();
      }
    }

    // Barco (blink si invulnerable)
    const blink = (state.time*1000 < state.invulnUntil) && (Math.floor(state.time*10)%2===0);
    if (!blink){
      if (images.boat){
        ctx.drawImage(images.boat, state.boat.x - state.boat.w/2, state.boat.y - state.boat.h/2, state.boat.w, state.boat.h);
      } else {
        drawBoatShape(ctx, state.boat.x, state.boat.y, state.boat.w, state.boat.h);
      }
    }
  }

  function drawBoatShape(ctx, cx, cy, w, h){
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#e11d48';
    ctx.strokeStyle = '#991b1b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -h/2);
    ctx.lineTo(w/2, h/2 - 10);
    ctx.quadraticCurveTo(0, h/2, -w/2, h/2 - 10);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(-w*0.25, -h*0.15, w*0.5, h*0.45);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(-w*0.18, -h*0.05, w*0.36, h*0.16);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr,y);
    ctx.arcTo(x+w,y,x+w,y+h,rr);
    ctx.arcTo(x+w,y+h,x,y+h,rr);
    ctx.arcTo(x,y+h,x,y,rr);
    ctx.arcTo(x,y,x+w,y,rr);
    ctx.closePath();
  }

  // ====== GAME STATE ======
  function win(){
    state.running = false;
    showOverlay('¡Has ganado! 🏆', `Has recogido ${WIN_COINS} monedas.`, false, true);
    pauseBtn.textContent = '▶️';
  }

  function gameOver(){
    state.running = false;
    showOverlay('Game Over 💥', `Monedas: ${state.coins}/${WIN_COINS}`, false, true);
    pauseBtn.textContent = '▶️';
  }

  function resetGame(){
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
    hideOverlay();
  }

  function togglePause(){
    state.running = !state.running;
    pauseBtn.textContent = state.running ? '⏸' : '▶️';
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

    images.water = await loadImage(ASSETS.water);
    images.boat  = await loadImage(ASSETS.boat);
    images.coin  = await loadImage(ASSETS.coin);
    images.rock  = await loadImage(ASSETS.rock);
    waterPatternEnabled = !!images.water;

    startBtn.addEventListener('click', resetGame);
    restartBtn.addEventListener('click', resetGame);
    pauseBtn.addEventListener('click', togglePause);

    // Mostrar portada inicial
    showOverlay('Boat Run', 'Recoge 10 monedas y evita las rocas', true, false);

    requestAnimationFrame(loop);
  }

  init();
})();