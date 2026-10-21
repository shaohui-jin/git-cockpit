/* ==========================================================================
   Git Cockpit · 主色切换
   teal（主推，默认）/ 极地白（data-accent="white"）
   localStorage 持久化，跨页生效。
   ========================================================================== */
(function () {
  'use strict';

  var KEY = 'gc-accent';
  var TEAL = 'teal';
  var WHITE = 'white';

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return v === WHITE ? WHITE : TEAL;
    } catch (e) {
      return TEAL;
    }
  }

  function apply(accent) {
    var root = document.documentElement;
    if (accent === WHITE) {
      root.setAttribute('data-accent', WHITE);
    } else {
      root.removeAttribute('data-accent');
    }
    try {
      localStorage.setItem(KEY, accent);
    } catch (e) {
      /* 隐私模式下忽略 */
    }
    document.dispatchEvent(
      new CustomEvent('gc:accent', { detail: { accent: accent === WHITE ? WHITE : TEAL } })
    );
  }

  /* 尽早应用，避免首屏闪烁 */
  apply(read());

  /* 供 index.html 的显眼分段控件复用 */
  window.GCAccent = { apply: apply, read: read };

  function build() {
    if (document.querySelector('.accent-switch')) return;
    /* index.html 自带显眼分段控件，不再叠加浮动件 */
    if (document.body.hasAttribute('data-no-float-switch')) return;

    var wrap = document.createElement('div');
    wrap.className = 'accent-switch';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', '主色方案切换');

    var lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = '主色';
    wrap.appendChild(lbl);

    [
      { id: TEAL, name: 'teal 青绿（主推）' },
      { id: WHITE, name: '极地白' }
    ].forEach(function (item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.accentSet = item.id;
      b.title = item.name;
      b.setAttribute('aria-label', item.name);
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        apply(item.id);
        sync();
      });
      wrap.appendChild(b);
    });

    document.body.appendChild(wrap);
    sync();
  }

  function sync() {
    var cur = read();
    var btns = document.querySelectorAll('.accent-switch button');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].dataset.accentSet === cur;
      btns[i].classList.toggle('is-on', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
