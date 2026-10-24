const STAGES = {
  terrain: ['TERRAIN.SYS', '標高・土地被覆データ'],
  runways: ['RUNWAY.SYS ', '滑走路データ'],
  city: ['CITY.SYS   ', '街を建設中'],
  trees: ['TREES.SYS  ', '木を植えています'],
  roads: ['ROADS.SYS  ', '道路を敷設中'],
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let screen = null;
let pending = null;
let ready = Promise.resolve();

function line(text = '', cls = '') {
  const el = document.createElement('div');
  el.className = `boot-line ${cls}`;
  el.textContent = text;
  screen.appendChild(el);
  return el;
}

function queue(fn) {
  ready = ready.then(fn);
  return ready;
}

function finishPending() {
  if (!pending) return;
  pending.textContent += ' 完了';
  pending.classList.add('ok');
  pending = null;
}

export function startBoot() {
  screen = document.getElementById('boot');
  queue(async () => {
    line('X68000 IPL-ROM Version 1.3');
    await wait(250);
    const mem = line('メモリチェック中 ... ');
    for (let kb = 0; kb <= 12288; kb += 1024) {
      mem.textContent = `メモリチェック中 ... ${String(kb).padStart(5)} KB`;
      await wait(35);
    }
    mem.textContent += ' OK';
    line('SRAM 16KB   FDD0: 2HD   HDD0: SASI 40MB');
    await wait(300);
    line();
    line('Observer68k version 3.02', 'bright');
    line('Copyright 1996 OBSERVER SOFT');
    line();
    await wait(250);
    line('CONFIG.SYS を実行しています');
    await wait(150);
  });
}

export function stage(key) {
  const [file, label] = STAGES[key] ?? [key, ''];
  queue(async () => {
    finishPending();
    pending = line(`  DEVICE = \\SYS\\${file}  ${label} ...`);
    await wait(120);
  });
}

export function bootError(message) {
  queue(async () => {
    line();
    line(`エラー: ${message}`, 'error');
    line('A>_');
  });
}

export function finishBoot() {
  return queue(async () => {
    finishPending();
    line();
    line('A>OBSERVE.X /BAY:TOKYO', 'bright');
    await wait(450);
    line('東京湾オブザーバー 起動中 ...');
    await wait(500);
    line('準備完了。観測を開始します。', 'ok');
    await wait(700);
  });
}
