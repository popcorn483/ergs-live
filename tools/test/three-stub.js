(() => { const mk = () => { const t = function(){}; t.__p = {}; return new Proxy(t, {
  get:(t, k) => { if (k === 'domElement') return t.__c || (t.__c = document.createElement('canvas')); if (k === Symbol.toPrimitive) return () => 0; if (k === 'then' || k === 'toJSON') return undefined;
    if (k === 'length') return 0; if (k === Symbol.iterator) return function*(){}; if (k === 'prototype') return t.prototype; if (!(k in t.__p)) t.__p[k] = mk(); return t.__p[k]; },
  set:(t, k, v) => { t.__p[k] = v; return true; }, has:() => true, construct:() => mk(), apply:() => mk()}); };
  window.THREE = mk(); window.Mp4Muxer = mk(); })();
