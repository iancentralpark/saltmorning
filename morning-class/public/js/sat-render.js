/**
 * Renders SAT question text. The text uses a small markup:
 *   \( ... \) and \[ ... \]   LaTeX (drawn with KaTeX when it is loaded)
 *   <u> <i> <b> <sup> <sub> <table> <tr> <th> <td>   the only tags kept
 *   [[fig1]]   a cropped figure
 * A dollar sign is always a literal dollar sign. Everything else is escaped.
 * Put the result in an element with class "sat-rich" (white-space: pre-wrap).
 */
(function (global) {
  'use strict';

  var MATH_RE = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
  var TAG_RE = /&lt;(\/?)(u|i|b|sup|sub|table|tr|th|td)&gt;/gi;
  var FIG_RE = /\[\[(fig[0-9a-z_-]*)\]\]/gi;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mathHtml(tex, display) {
    if (global.katex && global.katex.renderToString) {
      try {
        return global.katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore' });
      } catch (e) {
        return '<code class="sat-math-error" title="' + esc(e.message) + '">' + esc(tex) + '</code>';
      }
    }
    return '<code>' + esc(tex) + '</code>';
  }

  function plainHtml(text, opts) {
    return esc(text)
      .replace(TAG_RE, function (m, close, name) { return '<' + close + name.toLowerCase() + '>'; })
      .replace(FIG_RE, function (m, ref) {
        var key = ref.toLowerCase();
        var url = opts && opts.figureUrl ? opts.figureUrl(key) : '';
        if (!url) return '<span class="sat-fig-missing">[그림 ' + esc(key) + ' 없음]</span>';
        return '<img class="sat-fig" src="' + esc(url) + '" alt="' + esc(key) + '" data-ref="' + esc(key) + '">';
      });
  }

  function html(text, opts) {
    var s = String(text == null ? '' : text);
    var out = '';
    var last = 0;
    s.replace(MATH_RE, function (seg, inline, display, index) {
      out += plainHtml(s.slice(last, index), opts);
      out += inline != null ? mathHtml(inline, false) : '<div class="sat-display">' + mathHtml(display, true) + '</div>';
      last = index + seg.length;
      return seg;
    });
    out += plainHtml(s.slice(last), opts);
    // Blocks bring their own spacing: drop the line breaks around them.
    return out
      .replace(/\n+(<div class="sat-display">|<table>)/g, '$1')
      .replace(/(<\/table>|<\/div>)\n+/g, '$1')
      .replace(/(<\/tr>|<table>)\s+/g, '$1');
  }

  global.SatRender = { html: html, esc: esc };
})(window);
