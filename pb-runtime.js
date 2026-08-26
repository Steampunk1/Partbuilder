// pb-runtime.js — standalone template runtime for Part Builder.
//
// A minimal, production port of the Claude Design dc-runtime (support.js),
// reduced to exactly the feature set the Part Builder template uses:
//   - {{ expr }} resolution: dotted paths, [index], ==/===/!=/!==, !, literals
//   - <sc-if value="{{ x }}"> and <sc-for list="{{ xs }}" as="name">
//   - style-hover / style-focus / style-active pseudo-state attributes
//   - controlled inputs/selects (value= + onChange=) via React 18 (vendored)
//   - one logic class per page: `class Component extends DCLogic` (app.js)
//
// Dropped from the original on purpose: editor bridges, streaming
// placeholders, <helmet> (the real <head> owns that now), x-import /
// dc-import / deck components, sibling-component fetching, hot reload.
// The semantics of everything kept match support.js so the template renders
// byte-for-byte the same UI. Load order: React UMD, this file, app.js.
(() => {
  'use strict';
  const React = window.React;
  const ReactDOM = window.ReactDOM;
  const h = React.createElement;

  // ---------- expression grammar (identical to dc-runtime resolve) ----------
  const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
  const NUMBER_RE = /^-?\d+(\.\d+)?$/;

  function parensWrapWhole(expr) {
    let depth = 0;
    for (let i = 0; i < expr.length - 1; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') {
        depth--;
        if (depth === 0) return false;
      }
    }
    return true;
  }

  function findTopLevelEquality(expr) {
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
      const c = expr[i];
      if (c === '[' || c === '(') depth++;
      else if (c === ']' || c === ')') depth--;
      else if (depth === 0 && (c === '=' || c === '!') && expr[i + 1] === '=') {
        if (i > 0 && (expr[i - 1] === '=' || expr[i - 1] === '!')) continue;
        if (!expr.slice(0, i).trim()) continue;
        const op = expr[i + 2] === '=' ? c + '==' : c + '=';
        return { index: i, op };
      }
    }
    return null;
  }

  function resolvePath(vals, expr) {
    const head = expr.match(IDENT_RE);
    if (!head) return undefined;
    let cur = vals == null ? undefined : vals[head[0]];
    let i = head[0].length;
    while (i < expr.length) {
      if (expr[i] === '.') {
        const m = expr.slice(i + 1).match(IDENT_RE) || expr.slice(i + 1).match(/^\d+/);
        if (!m) return undefined;
        cur = cur == null ? undefined : cur[m[0]];
        i += 1 + m[0].length;
      } else if (expr[i] === '[') {
        let depth = 1;
        let j = i + 1;
        while (j < expr.length && depth > 0) {
          if (expr[j] === '[') depth++;
          else if (expr[j] === ']') {
            depth--;
            if (depth === 0) break;
          }
          j++;
        }
        if (depth !== 0) return undefined;
        const key = resolve(vals, expr.slice(i + 1, j));
        cur = cur == null ? undefined : cur[key];
        i = j + 1;
      } else {
        return undefined;
      }
    }
    return cur;
  }

  function resolve(vals, src) {
    const expr = String(src).trim();
    if (!expr) return undefined;
    if (expr[0] === '(' && expr[expr.length - 1] === ')' && parensWrapWhole(expr)) {
      return resolve(vals, expr.slice(1, -1));
    }
    const eq = findTopLevelEquality(expr);
    if (eq) {
      const lv = resolve(vals, expr.slice(0, eq.index));
      const rv = resolve(vals, expr.slice(eq.index + eq.op.length));
      switch (eq.op) {
        case '===': return lv === rv;
        case '!==': return lv !== rv;
        case '==': return lv == rv;
        default: return lv != rv;
      }
    }
    if (expr[0] === '!') return !resolve(vals, expr.slice(1));
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (expr === 'undefined') return undefined;
    if (NUMBER_RE.test(expr)) return Number(expr);
    if (expr.length >= 2 && (expr[0] === '"' || expr[0] === "'") && expr[expr.length - 1] === expr[0]) {
      return expr.slice(1, -1);
    }
    return resolvePath(vals, expr);
  }

  // ---------- source encoding (case + parser-safety), as in support.js ----------
  // HTML parsing lowercases attribute names and hoists <option> out of
  // anything that isn't a <select>; these two rewrites preserve camelCase
  // attrs (onClick, viewBox) and template structure through innerHTML.
  const CAMEL_ATTR = 'sc-camel-';
  const CAMEL_ATTR_RE = /(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g;
  const RAW_WRAP = {
    select: 'sc-raw-select', table: 'sc-raw-table', tbody: 'sc-raw-tbody',
    thead: 'sc-raw-thead', tfoot: 'sc-raw-tfoot', tr: 'sc-raw-tr',
    td: 'sc-raw-td', th: 'sc-raw-th', caption: 'sc-raw-caption'
  };
  const RAW_UNWRAP = Object.fromEntries(Object.entries(RAW_WRAP).map(([k, v]) => [v, k]));

  function encodeCamelAttrs(html) {
    return html.replace(CAMEL_ATTR_RE, (_, sp, name, eq) =>
      sp + CAMEL_ATTR + name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + eq);
  }

  function encodeCase(html) {
    html = encodeCamelAttrs(html);
    for (const [real, alias] of Object.entries(RAW_WRAP)) {
      html = html.replace(new RegExp('(</?)' + real + '(?=[\\s>])', 'gi'), '$1' + alias);
    }
    return html;
  }

  const EVENT_MAP = {
    onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onsubmit: 'onSubmit',
    onkeydown: 'onKeyDown', onkeyup: 'onKeyUp', onkeypress: 'onKeyPress',
    onmousedown: 'onMouseDown', onmouseup: 'onMouseUp', onmouseenter: 'onMouseEnter',
    onmouseleave: 'onMouseLeave', onfocus: 'onFocus', onblur: 'onBlur',
    ondoubleclick: 'onDoubleClick', oncontextmenu: 'onContextMenu',
    onmousemove: 'onMouseMove', onmouseover: 'onMouseOver', onmouseout: 'onMouseOut',
    onpointerdown: 'onPointerDown', onpointerup: 'onPointerUp', onpointermove: 'onPointerMove',
    onpointerenter: 'onPointerEnter', onpointerleave: 'onPointerLeave',
    onpointercancel: 'onPointerCancel', onpointerover: 'onPointerOver', onpointerout: 'onPointerOut',
    ontouchstart: 'onTouchStart', ontouchend: 'onTouchEnd', ontouchmove: 'onTouchMove',
    ontouchcancel: 'onTouchCancel', ondragstart: 'onDragStart', ondragend: 'onDragEnd',
    ondragenter: 'onDragEnter', ondragleave: 'onDragLeave', ondragover: 'onDragOver',
    onanimationstart: 'onAnimationStart', onanimationend: 'onAnimationEnd',
    onanimationiteration: 'onAnimationIteration', ontransitionend: 'onTransitionEnd'
  };

  function kebabToCamel(s) {
    return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  function cssToObj(css) {
    const o = {};
    for (const decl of css.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim();
      o[prop.startsWith('--') ? prop : kebabToCamel(prop)] = decl.slice(i + 1).trim();
    }
    return o;
  }

  function compileAttr(raw) {
    const whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
    if (whole) {
      const path = whole[1];
      return (vals) => resolve(vals, path);
    }
    if (raw.includes('{{')) {
      const parts = raw.split(/\{\{([\s\S]+?)\}\}/g);
      return (vals) => parts.map((s, i) => (i & 1 ? resolve(vals, s) ?? '' : s)).join('');
    }
    return () => raw;
  }

  // ---------- style-hover/focus/active pseudo sheet (as in support.js) ----------
  function scanUnquotedUrl(css, i) {
    if ((css[i] !== 'u' && css[i] !== 'U') || css.slice(i, i + 4).toLowerCase() !== 'url(' ||
        /[a-z0-9_-]/i.test(css[i - 1] ?? '')) {
      return -1;
    }
    let j = i + 4;
    while (j < css.length && /\s/.test(css[j])) j++;
    if (css[j] === '"' || css[j] === "'") return -1;
    while (j < css.length && css[j] !== ')') {
      if (css[j] === '\\') j++;
      j++;
    }
    return j < css.length ? j + 1 : css.length;
  }

  function stripComments(css) {
    let out = '';
    let quote = '';
    for (let i = 0; i < css.length; i++) {
      const c = css[i];
      if (quote) {
        if (c === '\\') { out += c + (css[i + 1] ?? ''); i++; continue; }
        if (c === quote) quote = '';
        out += c;
      } else if (c === "'" || c === '"') {
        quote = c;
        out += c;
      } else if (c === '/' && css[i + 1] === '*') {
        const end = css.indexOf('*/', i + 2);
        i = end === -1 ? css.length : end + 1;
        out += ' ';
      } else {
        const end = scanUnquotedUrl(css, i);
        if (end === -1) out += c;
        else { out += css.slice(i, end); i = end - 1; }
      }
    }
    return out;
  }

  function importantify(css) {
    css = stripComments(css);
    const decls = [];
    let start = 0, depth = 0, quote = '';
    for (let i = 0; i < css.length; i++) {
      const c = css[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = '';
      } else if (c === "'" || c === '"') quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (c === ';' && depth === 0) {
        decls.push(css.slice(start, i));
        start = i + 1;
      } else {
        const end = scanUnquotedUrl(css, i);
        if (end !== -1) i = end - 1;
      }
    }
    decls.push(css.slice(start));
    return decls.map((d) => d.trim()).filter(Boolean)
      .map((d) => (/!\s*important$/i.test(d) ? d : d + ' !important')).join(';');
  }

  function createPseudoSheet(doc) {
    let el = null;
    const cache = new Map();
    let n = 0;
    return (pseudo, css) => {
      const k = pseudo + '|' + css;
      const hit = cache.get(k);
      if (hit) return hit;
      if (!el) {
        el = doc.createElement('style');
        doc.head.appendChild(el);
      }
      const cls = 'scp' + (n++).toString(36);
      const isPseudoElement = pseudo === 'before' || pseudo === 'after';
      const sel = isPseudoElement ? '.' + cls + '::' + pseudo : '.' + cls + ':' + pseudo;
      el.sheet.insertRule(sel + '{' + (isPseudoElement ? css : importantify(css)) + '}',
        el.sheet.cssRules.length);
      cache.set(k, cls);
      return cls;
    };
  }

  const pseudoClass = createPseudoSheet(document);

  // ---------- template compilation ----------
  function collectProps(node) {
    const propGetters = [];
    const pseudoClasses = [];
    for (const { name, value } of [...node.attributes]) {
      if (name === 'sc-name' || name === 'data-dc-tpl') continue;
      let key = name;
      if (key.startsWith(CAMEL_ATTR)) key = kebabToCamel(key.slice(CAMEL_ATTR.length));
      if (key === 'hint-size') continue;
      if (key.startsWith('style-')) {
        pseudoClasses.push(pseudoClass(key.slice(6), value));
        continue;
      }
      if (key === 'class') key = 'className';
      else if (key === 'for') key = 'htmlFor';
      else if (key.startsWith('on')) {
        key = EVENT_MAP[key] || 'on' + key[2].toUpperCase() + key.slice(3);
      }
      propGetters.push([key, compileAttr(value)]);
    }
    return { propGetters, pseudoClasses };
  }

  const warnedHoles = new Set();
  function warnUnresolved(what) {
    if (warnedHoles.has(what)) return;
    warnedHoles.add(what);
    console.warn('[pb-runtime] ' + what);
  }

  function walkText(node) {
    const txt = node.nodeValue ?? '';
    if (!txt.includes('{{')) {
      if (!txt.trim() && !txt.includes(' ')) return null;
      return () => txt;
    }
    const parts = txt.split(/\{\{([\s\S]+?)\}\}/g);
    return (vals, ctx, key) => h(
      React.Fragment,
      { key },
      ...parts.map((p, i) => {
        if (!(i & 1)) return p;
        const v = resolve(vals, p);
        if (v === undefined) {
          warnUnresolved('{{ ' + p.trim() + ' }} never resolved — rendered as empty');
          return null;
        }
        if (React.isValidElement(v) || Array.isArray(v)) {
          return h(React.Fragment, { key: i }, v);
        }
        if (v === null || typeof v === 'boolean') return null;
        return h('span', { key: i, className: 'sc-interp' }, String(v));
      })
    );
  }

  function walkFor(el) {
    const listGet = compileAttr(el.getAttribute('list') || '');
    const asName = el.getAttribute('as') || 'item';
    const listSrc = el.getAttribute('list') || '';
    const kids = walkChildren(el);
    return (vals, ctx, key) => {
      let list = listGet(vals);
      if (!Array.isArray(list)) {
        if (list !== undefined && list !== null) {
          warnUnresolved('sc-for list="' + listSrc + '" is not an array (' + typeof list + ')');
        }
        list = [];
      }
      return h(
        React.Fragment,
        { key },
        list.map((item, i) => {
          const sub = { ...vals, [asName]: item, $index: i };
          return h(React.Fragment, { key: i }, kids.map((b, j) => b(sub, ctx, j)));
        })
      );
    };
  }

  function walkIf(el) {
    const valGet = compileAttr(el.getAttribute('value') || '');
    const kids = walkChildren(el);
    return (vals, ctx, key) =>
      valGet(vals) ? h(React.Fragment, { key }, kids.map((b, j) => b(vals, ctx, j))) : null;
  }

  // Elements whose only descendants are inline text tags get a content-derived
  // key suffix, so structurally different sc-if branches at the same child
  // index remount instead of morphing into each other (same trick as the
  // original runtime).
  const INLINE_TEXT_TAGS = new Set(
    'a abbr b bdi bdo br cite code del dfn em i ins kbd mark q s samp small span strike strong sub sup u var wbr'.split(' ')
  );
  const NEVER_CONTENT_KEYED = new Set(
    'script style textarea option title select canvas iframe video audio'.split(' ')
  );
  const NOT_INLINE_SELECTOR = ':not(' + [...INLINE_TEXT_TAGS].join(',') + ')';

  function contentKey(el) {
    const clone = el.cloneNode(true);
    for (const d of clone.querySelectorAll('*')) {
      while (d.attributes.length) d.removeAttribute(d.attributes[0].name);
    }
    const s = clone.innerHTML;
    let h2 = 5381;
    for (let i = 0; i < s.length; i++) h2 = ((h2 << 5) + h2 + s.charCodeAt(i)) | 0;
    return s.length + '.' + (h2 >>> 0).toString(36);
  }

  function walkElement(el) {
    const realTag = RAW_UNWRAP[el.localName] || el.localName;
    const inlineOnly = el.childNodes.length > 0 && !NEVER_CONTENT_KEYED.has(realTag) &&
      el.querySelector(NOT_INLINE_SELECTOR) === null;
    const keySuffix = inlineOnly ? '|' + contentKey(el) : '';
    const { propGetters, pseudoClasses } = collectProps(el);
    const kids = walkChildren(el);
    return (vals, ctx, key) => {
      const props = { key: key + keySuffix };
      for (const [k, g] of propGetters) {
        let v = g(vals);
        if (k === 'style' && typeof v === 'string') v = cssToObj(v);
        if ((k === 'value' || k === 'checked') && v === undefined) {
          v = k === 'checked' ? false : '';
        }
        props[k] = v;
      }
      if (pseudoClasses.length) {
        props.className = [props.className, ...pseudoClasses].filter(Boolean).join(' ');
      }
      return h(realTag, props, ...kids.map((b, j) => b(vals, ctx, j)));
    };
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return walkText(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = node.tagName.toLowerCase();
    if (tag === 'sc-for') return walkFor(node);
    if (tag === 'sc-if') return walkIf(node);
    if (tag === 'sc-helmet' || tag === 'helmet') return null; // head is static now
    return walkElement(node);
  }

  function walkChildren(node) {
    return [...node.childNodes].map((c) => walk(c)).filter((b) => b != null);
  }

  function compileTemplate(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = encodeCase(html);
    const builders = walkChildren(tpl.content);
    return (vals, ctx) => builders.map((b, i) => b(vals || {}, ctx, i));
  }

  // ---------- logic base class ----------
  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
      this.__host = null;
    }
    setState(update, cb) {
      this.__host && this.__host.__setLogicState(update, cb);
    }
    forceUpdate() {
      this.__host && this.__host.forceUpdate();
    }
    componentDidMount() {}
    componentDidUpdate(_prevProps) {}
    componentWillUnmount() {}
    /** The flat object the template renders against (merged over props). */
    renderVals() { return {}; }
  }
  window.DCLogic = DCLogic;

  // ---------- host component + boot ----------
  function createHost(LogicClass, tpl) {
    class Host extends React.Component {
      constructor(props) {
        super(props);
        this.state = { __v: 0, __err: null };
        this.logic = new LogicClass(props);
        this.logic.__host = this;
      }
      static getDerivedStateFromError(e) {
        return { __err: e instanceof Error && e.message ? e.message : String(e) };
      }
      componentDidCatch(e, info) {
        console.error('[pb-runtime] render error:', e, (info && info.componentStack) || '');
      }
      __setLogicState(update, cb) {
        const prev = this.logic.state;
        const patch = typeof update === 'function' ? update(prev) : update;
        this.logic.state = { ...prev, ...patch };
        this.setState((s) => ({ __v: s.__v + 1 }), cb);
      }
      componentDidMount() {
        try { this.logic.componentDidMount(); } catch (e) { console.error(e); }
      }
      componentDidUpdate(prevProps) {
        this.logic.props = this.props;
        try { this.logic.componentDidUpdate(prevProps); } catch (e) { console.error(e); }
      }
      componentWillUnmount() {
        try { this.logic.componentWillUnmount(); } catch (e) { console.error(e); }
      }
      render() {
        if (this.state.__err) {
          return h('div', { className: 'sc-host sc-has-error' },
            h('div', { className: 'sc-logic-error' }, 'Part Builder: ' + this.state.__err));
        }
        this.logic.props = this.props;
        let vals = this.props;
        let renderErr = null;
        try {
          vals = { ...this.props, ...(this.logic.renderVals() || {}) };
        } catch (e) {
          console.error(e);
          renderErr = 'renderVals(): ' + (e instanceof Error && e.message ? e.message : String(e));
        }
        return h('div', { className: 'sc-host' + (renderErr ? ' sc-has-error' : '') },
          renderErr && h('div', { className: 'sc-logic-error' }, renderErr),
          tpl(vals, this));
      }
    }
    return Host;
  }

  // Defaults from the prototype's data-props ($preview omitted).
  const PROP_DEFAULTS = { stations: '192', holeSegs: '28', edgeGlow: true };

  function boot() {
    let LogicClass = null;
    try { LogicClass = Component; } catch (e) {} // declared by app.js
    if (typeof LogicClass !== 'function') {
      console.error('[pb-runtime] app.js did not define `class Component extends DCLogic`');
      return;
    }
    const srcEl = document.querySelector('script[type="text/pb-template"]');
    const rootEl = document.getElementById('pb-root');
    if (!srcEl || !rootEl) {
      console.error('[pb-runtime] missing template script or #pb-root mount point');
      return;
    }
    const tpl = compileTemplate(srcEl.textContent || '');
    const Host = createHost(LogicClass, tpl);
    ReactDOM.createRoot(rootEl).render(h(Host, PROP_DEFAULTS));
  }

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
