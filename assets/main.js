/* =========================================================================
   小小星球 · 2D 动画
   -------------------------------------------------------------------------
   结构：
     1. 配置 / 调色板
     2. 通用工具函数
     3. 场景搭建（星球几何、景物槽位、星星、云）
     4. 绘制：天空 / 星星 / 太阳月亮 / 云 / 小鸟 / 星球 / 景物 / 小女孩 / 萤火虫
     5. 主循环与交互
   只有原生 Canvas 2D，没有任何依赖。
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     1. 配置与调色板
     --------------------------------------------------------------------- */

  // 想让画面更快 / 更慢、更换随机风景，改这里就够了
  var CONFIG = {
    rotationSpeed: 0.05,   // 星球自转角速度（弧度/秒），景物因此向左流动
    fadeDuration: 1.15,    // 白天 <-> 夜晚 的过渡时长（秒）
    propSlots: 64,         // 环绕星球的景物槽位（房子、树、花……）
    detailSlots: 150,      // 地表细节（草簇、小石子）槽位
    seed: 20261108         // 改变它就会得到另一颗星球
  };

  // 白天
  var DAY = {
    sky0: '#8ED3E6', sky1: '#B9E5DB', sky2: '#EEE9CD', sky3: '#F8EDCF',
    sunGlow: '#FFE9A8', moonCrater: '#D6CFB8', star: '#FFFDF2',
    orbCore: '#FFF4C9', orbBody: '#FFD166', orbEdge: '#F4BC52',
    cloud: '#FFFFFF',
    grassLight: '#A6DCA9', grass: '#8ACB9B', grassDeep: '#6AAE87', soil: '#548F72', fg: '#417457',
    trunk: '#9C6C4D', leafA: '#5FA87E', leafB: '#7CC08D', leafC: '#A2D8A0',
    house: '#F8EBDC', houseSide: '#EFDCC8', roof: '#DD9179', roofDark: '#C4705F',
    win: '#9FB6C4', door: '#B57E66', stone: '#BFC9BF',
    flowerA: '#F49BB0', flowerB: '#FFD57E', flowerC: '#FFF8EF',
    stick: '#463A52',
    firefly: '#FFE38A', haze: '#FFF4D6'
  };

  // 夜晚
  var NIGHT = {
    sky0: '#0D1230', sky1: '#1A2044', sky2: '#322E56', sky3: '#4A3D62',
    sunGlow: '#9FA8E0', moonCrater: '#CFC7B0', star: '#FFF8E4',
    orbCore: '#FFFDF3', orbBody: '#F3EEDA', orbEdge: '#D9D2BC',
    cloud: '#393D63',
    grassLight: '#466F6B', grass: '#365F60', grassDeep: '#25454F', soil: '#1F3945', fg: '#1B3540',
    trunk: '#4B3B49', leafA: '#2D565B', leafB: '#3A6A68', leafC: '#4A7B72',
    house: '#7C6C79', houseSide: '#685A6B', roof: '#7C5966', roofDark: '#684655',
    win: '#FFC46B', door: '#59404F', stone: '#4E5560',
    flowerA: '#B77F96', flowerB: '#C7A268', flowerC: '#E6DCD0',
    stick: '#41395A',
    firefly: '#FFE9A0', haze: '#6E5C8A'
  };

  /* ---------------------------------------------------------------------
     2. 工具函数
     --------------------------------------------------------------------- */

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var sunButton = document.querySelector('.sun-toggle');
  var statusEl = document.getElementById('status');
  var themeMeta = document.getElementById('theme-color');

  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduceMotion = motionQuery ? motionQuery.matches : false;

  var W = 0, H = 0, unit = 40;
  var planet = { cx: 0, cy: 0, R: 1400, topY: 0, thetaMax: 0.5 };
  var sun = { x: 0, y: 0, r: 60 };
  var girl = { x: 0, y: 0, h: 140, tilt: 0 };
  var state = { t: 0, target: 0, rot: 0, time: 0, hover: false };

  var props = [];
  var details = [];
  var stars = [];
  var clouds = [];
  var fireflies = [];
  var birds = [];

  var rgbCache = Object.create(null);

  function parseHex(hex) {
    var cached = rgbCache[hex];
    if (cached) return cached;
    var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    var n = parseInt(h, 16);
    cached = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache[hex] = cached;
    return cached;
  }

  function css(color, alpha) {
    return 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' +
      (alpha === undefined ? 1 : alpha) + ')';
  }

  function mixColor(a, b, t) {
    var A = parseHex(a), B = parseHex(b);
    return [
      Math.round(A[0] + (B[0] - A[0]) * t),
      Math.round(A[1] + (B[1] - A[1]) * t),
      Math.round(A[2] + (B[2] - A[2]) * t)
    ];
  }

  function mixPalette(t) {
    var out = {};
    for (var key in DAY) {
      if (!Object.prototype.hasOwnProperty.call(DAY, key)) continue;
      out[key] = mixColor(DAY[key], NIGHT[key], t);
    }
    return out;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(x) {
    x = clamp(x, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function wrapAngle(a) {
    a = a % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    else if (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 路径工具
  function rrectPath(x, y, w, h, r) {
    r = Math.min(r === undefined ? 0 : r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function box(x, y, w, h, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    rrectPath(x, y, w, h, r);
    ctx.fill();
  }

  function circle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function ellipse(x, y, rx, ry, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------------------------------------------------------------------
     3. 场景搭建
     --------------------------------------------------------------------- */

  function buildProps() {
    var rand = mulberry32(CONFIG.seed);
    var table = [
      ['house', 15], ['treeRound', 14], ['treePine', 12], ['bush', 11],
      ['flowers', 16], ['lamp', 5], ['stone', 7], ['blank', 12]
    ];
    var total = 0;
    var i;
    for (i = 0; i < table.length; i++) total += table[i][1];

    function pick() {
      var r = rand() * total;
      for (var k = 0; k < table.length; k++) {
        r -= table[k][1];
        if (r <= 0) return table[k][0];
      }
      return 'blank';
    }

    props = [];
    for (i = 0; i < CONFIG.propSlots; i++) {
      var type = pick();
      if (type === 'blank') continue;
      props.push({
        ang: (i / CONFIG.propSlots) * Math.PI * 2 + (rand() - 0.5) * 0.03,
        type: type,
        scale: 0.82 + rand() * 0.42,
        v: rand()
      });
    }

    details = [];
    var detailTable = [['tuft', 58], ['pebble', 18], ['bloom', 24]];
    var dtotal = detailTable.reduce(function (s, d) { return s + d[1]; }, 0);
    for (i = 0; i < CONFIG.detailSlots; i++) {
      var r2 = rand() * dtotal;
      var dt = 'tuft';
      for (var j = 0; j < detailTable.length; j++) {
        r2 -= detailTable[j][1];
        if (r2 <= 0) { dt = detailTable[j][0]; break; }
      }
      details.push({
        ang: (i / CONFIG.detailSlots) * Math.PI * 2 + (rand() - 0.5) * 0.02,
        type: dt,
        scale: 0.3 + rand() * 0.34,
        v: rand()
      });
    }

    var srand = mulberry32(CONFIG.seed + 7);
    stars = [];
    for (i = 0; i < 140; i++) {
      stars.push({
        x: srand(),
        y: srand() * 0.62,
        r: 0.6 + srand() * 1.4,
        p: srand() * Math.PI * 2,
        big: srand() > 0.93
      });
    }

    var crand = mulberry32(CONFIG.seed + 13);
    clouds = [];
    for (i = 0; i < 4; i++) {
      clouds.push({
        x: crand(),
        y: 0.1 + crand() * 0.26,
        s: 0.7 + crand() * 0.7,
        sp: 0.004 + crand() * 0.005,
        p: crand() * 10
      });
    }

    var frand = mulberry32(CONFIG.seed + 21);
    fireflies = [];
    for (i = 0; i < 26; i++) {
      fireflies.push({
        x: frand(),
        y: 0.5 + frand() * 0.32,
        r: 1.1 + frand() * 1.5,
        p: frand() * Math.PI * 2,
        sp: 0.25 + frand() * 0.4
      });
    }

    birds = [
      { nx: 0.05, ny: 0.35, s: 1.0, sp: 0.0075, p: 0.0 },
      { nx: -0.12, ny: 0.39, s: 0.8, sp: 0.0105, p: 1.9 },
      { nx: 0.62, ny: 0.3, s: 0.9, sp: 0.0055, p: 3.4 }
    ];
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    W = w;
    H = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 星球：一段非常平缓的大圆弧，越平越像"一颗星球"而不是一座山
    var topY = h * 0.635;
    var half = w / 2;
    var drop = Math.max(h * 0.19, 70);
    var R = (half * half + drop * drop) / (2 * drop);
    R = Math.max(R, w * 0.85, 380);

    planet.R = R;
    planet.cx = w / 2;
    planet.cy = topY + R;
    planet.topY = topY;
    planet.thetaMax = Math.min(1.05, Math.asin(Math.min(1, half / R)));

    unit = Math.max(24, Math.min(80, Math.min(w * 0.039, h * 0.08)));

    sun.x = w * 0.54;
    sun.y = h * 0.2;
    sun.r = Math.max(40, Math.min(92, Math.min(w * 0.12, h * 0.085)));

    girl.h = Math.max(46, Math.min(108, Math.min(h * 0.097, w * 0.147)));
    girl.x = w * 0.46;
    var gdx = girl.x - planet.cx;
    girl.y = planet.cy - Math.sqrt(Math.max(0, R * R - gdx * gdx));
    girl.tilt = Math.asin(clamp(gdx / R, -1, 1));

    layoutSunButton();
    resizeGirl();
  }

  function layoutSunButton() {
    var size = Math.round(sun.r * 3.4);
    sunButton.style.width = size + 'px';
    sunButton.style.height = size + 'px';
    sunButton.style.transform =
      'translate(' + (sun.x - size / 2) + 'px,' + (sun.y - size / 2) + 'px)';
  }

  /* ---------------------------------------------------------------------
     4. 绘制
     --------------------------------------------------------------------- */

  function drawSky(P) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, css(P.sky0));
    g.addColorStop(0.42, css(P.sky1));
    g.addColorStop(0.76, css(P.sky2));
    g.addColorStop(1, css(P.sky3));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawStars(P, m) {
    ctx.save();
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(state.time * 1.7 + s.p);
      var a = m * (0.35 + 0.65 * tw);
      if (a <= 0.01) continue;
      var x = s.x * W;
      var y = s.y * H;
      if (s.big) {
        ctx.fillStyle = css(P.star, a * 0.9);
        ctx.beginPath();
        ctx.arc(x, y, s.r * 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = css(P.star, a * 0.45);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - s.r * 4, y);
        ctx.lineTo(x + s.r * 4, y);
        ctx.moveTo(x, y - s.r * 4);
        ctx.lineTo(x, y + s.r * 4);
        ctx.stroke();
      } else {
        ctx.fillStyle = css(P.star, a);
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawSunMoon(P, m) {
    var x = sun.x, y = sun.y, r = sun.r;
    var introPulse = state.time < 9 && !reduceMotion ? 1 + Math.sin(state.time * 2.2) * 0.025 : 1;
    var hoverPulse = state.hover ? 1.05 : 1;
    var scale = introPulse * hoverPulse;

    // 日光与月晕此消彼长，中间的球体始终是实心的
    var sunA = 1 - smoothstep(m / 0.6);
    var moonA = smoothstep((m - 0.4) / 0.6);

    if (sunA > 0.01) {
      var wash = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 6);
      wash.addColorStop(0, css(P.sunGlow, 0.3 * sunA));
      wash.addColorStop(0.45, css(P.sunGlow, 0.08 * sunA));
      wash.addColorStop(1, css(P.sunGlow, 0));
      ctx.fillStyle = wash;
      ctx.beginPath();
      ctx.arc(x, y, r * 6, 0, Math.PI * 2);
      ctx.fill();

      // 光芒
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(state.time * 0.12);
      ctx.strokeStyle = css(P.sunGlow, 0.42 * sunA);
      ctx.lineWidth = Math.max(1.5, r * 0.06);
      ctx.lineCap = 'round';
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2;
        var r0 = r * 1.42;
        var r1 = r * (1.58 + (i % 2) * 0.1);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * r1 * scale, Math.sin(a) * r1 * scale);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (moonA > 0.01) {
      var halo = ctx.createRadialGradient(x, y, r * 0.7, x, y, r * 3.6);
      halo.addColorStop(0, css(P.star, 0.26 * moonA));
      halo.addColorStop(0.4, css(P.star, 0.08 * moonA));
      halo.addColorStop(1, css(P.star, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 天体本体
    var body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.32, r * 0.1, x, y, r * 1.04);
    body.addColorStop(0, css(P.orbCore));
    body.addColorStop(0.7, css(P.orbBody));
    body.addColorStop(1, css(P.orbEdge));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y, r * scale, 0, Math.PI * 2);
    ctx.fill();

    // 环形山
    if (moonA > 0.01) {
      var craters = [
        [0.3, -0.16, 0.19], [-0.24, 0.24, 0.13], [0.02, 0.4, 0.09],
        [-0.42, -0.3, 0.08], [0.15, 0.05, 0.06]
      ];
      for (var c = 0; c < craters.length; c++) {
        var cr = craters[c];
        ctx.fillStyle = css(P.moonCrater, 0.55 * moonA);
        ctx.beginPath();
        ctx.ellipse(x + cr[0] * r, y + cr[1] * r, cr[2] * r, cr[2] * r * 0.86,
          0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 悬停时的一圈描边，提示这里可以点
    if (state.hover) {
      ctx.strokeStyle = css(P.star, 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.28, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function cloudShape(x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y + 8 * s, 52 * s, 17 * s, 0, 0, Math.PI * 2);
    ctx.arc(x - 24 * s, y + 2 * s, 17 * s, 0, Math.PI * 2);
    ctx.arc(x + 4 * s, y - 10 * s, 24 * s, 0, Math.PI * 2);
    ctx.arc(x + 30 * s, y + 2 * s, 15 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawClouds(P, m) {
    ctx.save();
    ctx.globalAlpha = 0.92 - 0.22 * m;
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var span = W + 320;
      var x = ((c.x * span + state.time * c.sp * W) % span) - 160;
      var y = c.y * H + Math.sin(state.time * 0.35 + c.p) * 4;
      cloudShape(x, y, c.s * (W < 600 ? 0.7 : 1), css(P.cloud));
    }
    ctx.restore();
  }

  function drawBirds(P, m) {
    if (m > 0.55) return;
    ctx.save();
    ctx.globalAlpha = (1 - m / 0.55) * 0.42;
    ctx.strokeStyle = css(P.leafA);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (var i = 0; i < birds.length; i++) {
      var b = birds[i];
      var span = W * 1.3;
      var x = ((b.nx + state.time * b.sp) % 1.3 * span) - W * 0.15;
      var y = b.ny * H + Math.sin(state.time * 0.8 + b.p) * 6;
      var flap = Math.sin(state.time * 6 + b.p) * 0.6 + 0.6;
      var s = 7 * b.s;
      ctx.beginPath();
      ctx.moveTo(x - s, y);
      ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.9 * flap, x, y);
      ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.9 * flap, x + s, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlanet(P, m) {
    var p = planet;

    // 大气：贴着地平线的一层柔光
    ctx.save();
    ctx.strokeStyle = css(P.haze, 0.28);
    ctx.lineWidth = Math.max(8, unit * 0.3);
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.R + unit * 0.14,
      -Math.PI / 2 - p.thetaMax - 0.35, -Math.PI / 2 + p.thetaMax + 0.35);
    ctx.stroke();
    ctx.strokeStyle = css(P.haze, 0.14);
    ctx.lineWidth = Math.max(18, unit * 0.7);
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.R + unit * 0.45,
      -Math.PI / 2 - p.thetaMax - 0.3, -Math.PI / 2 + p.thetaMax + 0.3);
    ctx.stroke();
    ctx.restore();

    // 大地
    var g = ctx.createLinearGradient(0, p.topY, 0, H);
    g.addColorStop(0, css(P.grassLight));
    g.addColorStop(0.35, css(P.grass));
    g.addColorStop(1, css(P.grassDeep));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.R, 0, Math.PI * 2);
    ctx.fill();

    // 地表边缘的一圈深色土壤
    ctx.strokeStyle = css(P.soil, 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.R - 1.2,
      -Math.PI / 2 - p.thetaMax - 0.4, -Math.PI / 2 + p.thetaMax + 0.4);
    ctx.stroke();

    // 靠近底部压暗，让球体有体积感
    var shade = ctx.createLinearGradient(0, p.topY + H * 0.05, 0, H);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(20,35,30,' + (0.12 + 0.12 * m) + ')');
    ctx.fillStyle = shade;
    ctx.fillRect(0, p.topY - 2, W, H - p.topY + 2);
  }

  // 把一个景物摆到星球表面的指定角度上
  function placeOnPlanet(ang, scale, drawFn) {
    var cp = Math.cos(ang);
    var sp = Math.sin(ang);
    var x = planet.cx + planet.R * sp;
    var y = planet.cy - planet.R * cp;
    var s = unit * scale * (0.74 + 0.26 * cp);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(s, s);
    drawFn();
    ctx.restore();
  }

  function drawDetails(P, m) {
    for (var i = 0; i < details.length; i++) {
      var d = details[i];
      var ang = wrapAngle(d.ang - state.rot);
      if (Math.abs(ang) > planet.thetaMax + 0.25) continue;
      placeOnPlanet(ang, d.scale, (function (item) {
        return function () { drawDetailShape(item, P, m); };
      })(d));
    }
  }

  function drawDetailShape(d, P, m) {
    if (d.type === 'tuft') {
      ctx.strokeStyle = css(P.leafA, 0.85);
      ctx.lineWidth = 0.06;
      ctx.lineCap = 'round';
      for (var i = 0; i < 3; i++) {
        var dx = (i - 1) * 0.1;
        ctx.beginPath();
        ctx.moveTo(dx, 0);
        ctx.quadraticCurveTo(dx + (i - 1) * 0.08, -0.2, dx + (i - 1) * 0.18, -0.34 - (i === 1 ? 0.08 : 0));
        ctx.stroke();
      }
    } else if (d.type === 'pebble') {
      ellipse(0, -0.05, 0.12, 0.08, css(P.stone, 0.85));
    } else {
      // 一朵很小的花
      ctx.strokeStyle = css(P.leafA, 0.8);
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-0.04, -0.15, 0, -0.28);
      ctx.stroke();
      var col = d.v > 0.6 ? P.flowerB : P.flowerA;
      circle(0, -0.3, 0.075, css(col, 0.9));
      circle(0, -0.3, 0.03, css(P.flowerC, 0.9));
    }
  }

  function drawProps(P, m) {
    // 窄屏上景物会挤在一起，按屏幕宽度抽稀，间距就拉开了
    var step = W < 620 ? 3 : (W < 900 ? 2 : 1);
    for (var i = 0; i < props.length; i++) {
      if (step > 1 && i % step !== 0) continue;
      var p = props[i];
      var ang = wrapAngle(p.ang - state.rot);
      if (Math.abs(ang) > planet.thetaMax + 0.3) continue;
      placeOnPlanet(ang, p.scale, (function (item) {
        return function () { drawPropShape(item, P, m); };
      })(p));
    }
  }

  function drawPropShape(p, P, m) {
    switch (p.type) {
      case 'house': drawHouse(P, m, p.v); break;
      case 'treePine': drawPine(P, p.v); break;
      case 'treeRound': drawRoundTree(P, p.v); break;
      case 'bush': drawBush(P, p.v); break;
      case 'flowers': drawFlowers(P, p.v); break;
      case 'lamp': drawLamp(P, m, p.v); break;
      case 'stone': drawStone(P, p.v); break;
      default: break;
    }
  }

  function drawWindow(x, y, w, h, P, m) {
    ctx.fillStyle = css(P.win);
    ctx.beginPath();
    rrectPath(x, y, w, h, 0.035);
    ctx.fill();

    if (m > 0.03) {
      ctx.globalAlpha = 0.32 * m;
      ctx.fillStyle = '#FFF3CE';
      ctx.beginPath();
      rrectPath(x, y, w, h, 0.035);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = css(P.houseSide, 0.9);
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
    ctx.moveTo(x, y + h / 2);
    ctx.lineTo(x + w, y + h / 2);
    ctx.stroke();
  }

  function drawHouse(P, m, v) {
    // 侧屋
    box(0.62, -1.5, 1.02, 1.5, 0.03, css(P.houseSide));
    box(0.55, -1.68, 1.16, 0.2, 0.05, css(P.roofDark));

    // 主屋
    box(-1.0, -2.2, 1.62, 2.2, 0.04, css(P.house));
    // 屋檐下的一点阴影
    ctx.fillStyle = css(P.houseSide, 0.55);
    ctx.fillRect(-1.0, -2.16, 1.62, 0.07);
    // 屋顶
    box(-1.1, -2.42, 1.82, 0.24, 0.06, css(P.roof));
    // 烟囱
    box(0.26, -2.8, 0.26, 0.45, 0.04, css(P.roofDark));

    // 门
    box(0.14, -0.8, 0.38, 0.8, 0.05, css(P.door));
    circle(0.44, -0.4, 0.028, css(P.win, 0.9));

    // 夜间窗户透出的光
    if (m > 0.02) {
      var gx = -0.56;
      var gy = -1.5;
      var glow = ctx.createRadialGradient(gx, gy, 0.05, gx, gy, 1.5);
      glow.addColorStop(0, css(P.win, 0.4 * m));
      glow.addColorStop(0.55, css(P.win, 0.12 * m));
      glow.addColorStop(1, css(P.win, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(gx, gy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 窗
    var wins = [[-0.78, -1.86], [-0.32, -1.86], [-0.78, -1.24], [-0.32, -1.24]];
    for (var i = 0; i < wins.length; i++) {
      drawWindow(wins[i][0], wins[i][1], 0.37, 0.4, P, m);
    }
    drawWindow(0.84, -1.28, 0.32, 0.34, P, m);
    drawWindow(1.22, -1.28, 0.32, 0.34, P, m);
  }

  function drawPine(P, v) {
    ctx.fillStyle = css(P.trunk);
    ctx.fillRect(-0.075, -0.62, 0.15, 0.64);

    for (var i = 0; i < 3; i++) {
      var halfW = 0.68 - i * 0.16;
      var bottom = -0.46 - i * 0.4;
      var top = bottom - 0.72 + i * 0.1;
      ctx.fillStyle = css(i % 2 === 0 ? P.leafA : P.leafB);
      ctx.beginPath();
      ctx.moveTo(0, top);
      ctx.quadraticCurveTo(halfW * 0.55, top + (bottom - top) * 0.5, halfW, bottom);
      ctx.quadraticCurveTo(0, bottom + 0.08, -halfW, bottom);
      ctx.quadraticCurveTo(-halfW * 0.55, top + (bottom - top) * 0.5, 0, top);
      ctx.fill();
    }
  }

  function drawRoundTree(P, v) {
    ctx.fillStyle = css(P.trunk);
    ctx.fillRect(-0.08, -0.95, 0.16, 0.97);

    ctx.fillStyle = css(P.leafA);
    circle(0, -1.44, 0.6);
    circle(-0.44, -1.16, 0.42);
    circle(0.45, -1.18, 0.44);

    ctx.fillStyle = css(P.leafB);
    circle(-0.14, -1.58, 0.42);
    circle(0.32, -1.46, 0.3);

    ctx.fillStyle = css(P.leafC, 0.75);
    circle(-0.2, -1.72, 0.22);
  }

  function drawBush(P, v) {
    ctx.fillStyle = css(P.leafA);
    ellipse(0, -0.3, 0.44, 0.32, css(P.leafA));
    ellipse(-0.36, -0.2, 0.3, 0.22, css(P.leafA));
    ellipse(0.38, -0.22, 0.32, 0.24, css(P.leafA));
    ctx.fillStyle = css(P.leafB);
    ellipse(-0.06, -0.42, 0.3, 0.22, css(P.leafB));
  }

  function drawFlowers(P, v) {
    var cols = [P.flowerA, P.flowerB, P.flowerC];
    for (var i = 0; i < 4; i++) {
      var x = (i - 1.5) * 0.3 + (i % 2 ? 0.04 : -0.03);
      var hgt = 0.5 + (i % 3) * 0.12;
      ctx.strokeStyle = css(P.leafA, 0.95);
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x - 0.05, -hgt * 0.6, x - 0.02, -hgt);
      ctx.stroke();

      var col = cols[(i + (v > 0.5 ? 1 : 0)) % 3];
      for (var k = 0; k < 5; k++) {
        var a = (k / 5) * Math.PI * 2 + i * 0.5;
        circle(x - 0.02 + Math.cos(a) * 0.058, -hgt + Math.sin(a) * 0.058, 0.052, css(col, 0.95));
      }
      circle(x - 0.02, -hgt, 0.032, css(P.flowerB, 0.95));
    }
  }

  function drawLamp(P, m, v) {
    ctx.fillStyle = css(P.trunk);
    ctx.fillRect(-0.04, -1.2, 0.08, 1.2);

    ctx.fillStyle = css(P.roofDark);
    ctx.beginPath();
    ctx.moveTo(-0.16, -1.18);
    ctx.lineTo(0.16, -1.18);
    ctx.lineTo(0.1, -1.44);
    ctx.lineTo(-0.1, -1.44);
    ctx.closePath();
    ctx.fill();

    if (m > 0.02) {
      var g = ctx.createRadialGradient(0, -1.26, 0.02, 0, -1.26, 0.85);
      g.addColorStop(0, css(P.win, 0.5 * m));
      g.addColorStop(1, css(P.win, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -1.26, 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
    circle(0, -1.28, 0.095, css(P.win));
  }

  function drawStone(P, v) {
    ellipse(0, -0.11, 0.24, 0.13, css(P.stone, 0.95));
    ellipse(-0.05, -0.16, 0.13, 0.09, css(P.stone, 0.65));
  }

  /* ---------------- 小女孩（独立 SVG） ---------------- */

  var girlLayer = document.getElementById('girl-layer');
  var girlSvg = document.getElementById('girl-svg');
  var gParts = {
    legNear: document.getElementById('g-leg-near'),
    shinNear: document.getElementById('g-shin-near'),
    legFar: document.getElementById('g-leg-far'),
    shinFar: document.getElementById('g-shin-far'),
    armNear: document.getElementById('g-arm-near'),
    foreNear: document.getElementById('g-fore-near'),
    armFar: document.getElementById('g-arm-far'),
    foreFar: document.getElementById('g-fore-far')
  };
  var girlColorT = -1;

  // SVG 画布是 200x360，脚底在 (100, 358)
  function resizeGirl() {
    var s = girl.h / 286;
    girlSvg.style.width = (200 * s) + 'px';
    girlSvg.style.height = (360 * s) + 'px';
    girlSvg.style.left = (-106 * s) + 'px';
    girlSvg.style.top = (-338 * s) + 'px';
  }

  function applyGirlColor(P) {
    girlSvg.style.setProperty('--g-stick', css(P.stick));
  }

  // 影子与夜里的暖光留在画布上，角色本体在 SVG 里
  function drawGirlShadow(P, m) {
    var r = girl.h;
    if (m > 0.02) {
      var glow = ctx.createRadialGradient(girl.x, girl.y - r * 0.55, r * 0.1,
        girl.x, girl.y - r * 0.55, r * 0.95);
      glow.addColorStop(0, 'rgba(255,226,180,' + (0.09 * m).toFixed(3) + ')');
      glow.addColorStop(1, 'rgba(255,226,180,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(girl.x, girl.y - r * 0.55, r * 0.95, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(30,20,40,' + (0.13 + 0.09 * m).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(girl.x, girl.y + r * 0.012, r * 0.175, r * 0.032, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function updateGirl(P, m) {
    var phase = state.time * 8.6;
    var bob = Math.abs(Math.sin(phase)) * 0.012 * girl.h;

    girlLayer.style.transform = 'translate(' + girl.x.toFixed(1) + 'px,' +
      (girl.y - bob).toFixed(1) + 'px) rotate(' + (girl.tilt * 57.2958).toFixed(2) + 'deg)';

    // 月亮出来以后给剪影一圈很淡的暖光，别让它沉进夜空
    girlLayer.style.filter = m > 0.02
      ? 'drop-shadow(0 0 ' + (7 * m).toFixed(1) + 'px rgba(255,226,180,' + (0.5 * m).toFixed(2) + '))'
      : 'none';

    // 大腿前后摆，向后时屈膝
    var nearThigh = Math.sin(phase) * 30;
    var farThigh = Math.sin(phase + Math.PI) * 30;
    var nearKnee = 8 + 52 * Math.max(0, Math.sin(phase - 0.4));
    var farKnee = 8 + 52 * Math.max(0, Math.sin(phase + Math.PI - 0.4));

    gParts.legNear.setAttribute('transform', 'rotate(' + nearThigh.toFixed(1) + ')');
    gParts.shinNear.setAttribute('transform', 'rotate(' + nearKnee.toFixed(1) + ' 0 56)');
    gParts.legFar.setAttribute('transform', 'rotate(' + farThigh.toFixed(1) + ')');
    gParts.shinFar.setAttribute('transform', 'rotate(' + farKnee.toFixed(1) + ' 0 56)');

    // 手臂与同侧腿反相，肘部向前折
    var nearArm = -nearThigh * 1.2 - 4;
    var farArm = -farThigh * 1.2 - 4;
    gParts.armNear.setAttribute('transform', 'rotate(' + nearArm.toFixed(1) + ')');
    gParts.armFar.setAttribute('transform', 'rotate(' + farArm.toFixed(1) + ')');
    gParts.foreNear.setAttribute('transform', 'rotate(' + (-40 + nearArm * 0.12).toFixed(1) + ' 0 38)');
    gParts.foreFar.setAttribute('transform', 'rotate(' + (-38 + farArm * 0.12).toFixed(1) + ' 0 38)');

    if (Math.abs(m - girlColorT) > 0.004) {
      girlColorT = m;
      applyGirlColor(P);
    }
  }

  /* 最靠近镜头的一层草：只贴住画面底边，流得比地表更快，用来拉开纵深 */
  function drawForeground(P, m) {
    var count = 20;
    var margin = 160;
    var span = W + margin * 2;
    var spacing = span / count;
    var drift = state.rot * 2600;

    ctx.save();
    ctx.strokeStyle = css(P.fg, 0.9);
    ctx.lineCap = 'round';
    for (var i = 0; i < count; i++) {
      var x = (((i * spacing - drift) % span) + span) % span - margin;
      var s = 0.72 + ((i * 37) % 11) / 14;
      var baseY = H + 10;
      for (var b = 0; b < 5; b++) {
        var bx = (b - 2) * 7.5 * s;
        var hgt = (46 + ((i * 13 + b * 29) % 42)) * s;
        var bend = Math.sin(state.time * 0.85 + i * 1.7 + b * 0.6) * 0.26 + (b - 2) * 0.26;
        ctx.strokeStyle = css(b % 3 === 0 ? P.grassDeep : P.fg, 0.85);
        ctx.lineWidth = (4.2 + (b % 2)) * s;
        ctx.beginPath();
        ctx.moveTo(x + bx, baseY);
        ctx.quadraticCurveTo(
          x + bx + bend * hgt * 0.5, baseY - hgt * 0.55,
          x + bx + bend * hgt * 1.25, baseY - hgt
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawFireflies(P, m) {
    if (m < 0.03) return;
    ctx.save();
    ctx.globalAlpha = m;
    for (var i = 0; i < fireflies.length; i++) {
      var f = fireflies[i];
      var x = f.x * W + Math.sin(state.time * f.sp + f.p) * 26;
      var y = f.y * H + Math.cos(state.time * f.sp * 0.8 + f.p) * 14;
      var blink = 0.35 + 0.65 * Math.abs(Math.sin(state.time * 1.1 + f.p));
      ctx.fillStyle = css(P.firefly, 0.16 * blink);
      ctx.beginPath();
      ctx.arc(x, y, f.r * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css(P.firefly, 0.9 * blink);
      ctx.beginPath();
      ctx.arc(x, y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawVignette(m) {
    var g = ctx.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.28,
      W * 0.5, H * 0.45, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(20,12,32,0)');
    g.addColorStop(1, 'rgba(20,12,32,' + (0.1 + 0.12 * m) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------------------------------------------------------------------
     5. 主循环、交互
     --------------------------------------------------------------------- */

  var lastTheme = '';

  function syncTheme(m) {
    var theme = m > 0.5 ? 'night' : 'day';
    if (theme === lastTheme) return;
    lastTheme = theme;
    if (themeMeta) themeMeta.setAttribute('content', theme === 'night' ? '#151A3A' : '#CFEADE');
    document.body.classList.toggle('is-night', theme === 'night');
  }


  function render() {
    var m = smoothstep(state.t);
    var P = mixPalette(m);

    drawSky(P);
    if (m > 0.01) drawStars(P, m);
    drawClouds(P, m);
    drawSunMoon(P, m);
    drawBirds(P, m);
    drawPlanet(P, m);
    drawDetails(P, m);
    drawProps(P, m);
    drawGirlShadow(P, m);
    updateGirl(P, m);
    drawForeground(P, m);
    drawFireflies(P, m);
    drawVignette(m);

    syncTheme(m);
  }

  var lastFrame = 0;

  function frame(now) {
    if (!lastFrame) lastFrame = now;
    var dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    var speed = reduceMotion ? 0.4 : 1;
    state.time += dt * speed;
    state.rot += CONFIG.rotationSpeed * dt * speed;

    if (state.t !== state.target) {
      var dir = state.target > state.t ? 1 : -1;
      state.t = clamp(state.t + (dir * dt) / CONFIG.fadeDuration, 0, 1);
      if (state.t > 1) state.t = 1;
      if (state.t < 0) state.t = 0;
    }

    render();
    requestAnimationFrame(frame);
  }

  function toggleDayNight() {
    var toNight = state.target < 0.5;
    state.target = toNight ? 1 : 0;
    if (statusEl) {
      statusEl.textContent = toNight
        ? '夜晚模式：月亮升起，房子里的灯亮了。'
        : '白天模式：太阳出来了。';
    }
  }

  sunButton.addEventListener('click', toggleDayNight);
  sunButton.addEventListener('pointerenter', function () { state.hover = true; });
  sunButton.addEventListener('pointerleave', function () { state.hover = false; });
  sunButton.addEventListener('focus', function () { state.hover = true; });
  sunButton.addEventListener('blur', function () { state.hover = false; });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      if (document.activeElement === sunButton) return; // 交给按钮自己处理
      e.preventDefault();
      toggleDayNight();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) lastFrame = 0;
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () {
    setTimeout(resize, 250);
  });

  if (motionQuery && motionQuery.addEventListener) {
    motionQuery.addEventListener('change', function (e) { reduceMotion = e.matches; });
  }

  // 调试用：?night 会直接以夜晚开场
  if (/[?&]night(=|&|$)/.test(location.search)) {
    state.t = 1;
    state.target = 1;
  }

  buildProps();
  resize();
  state.time = 0.14;   // 让第一帧就落在迈步的姿势上
  requestAnimationFrame(frame);
})();
