/* ================================================================
   INTERACTION SCRIPT — overview
   ----------------------------------------------------------------
   This IIFE (Immediately Invoked Function Expression) wires up
   all the hover/click behavior described in the CSS comments
   above. There are two kinds of "linkable" element in the page:

     1. SINGLE FIGURES — any element with data-id="xx-stat"
        (e.g. data-id="jp-life"). Always exactly one span in the
        essay and one <td> in the table share a given data-id.
        Hovering/clicking either one highlights BOTH (same id,
        wherever it appears) and draws ONE connector line.

     2. COUNTRY GROUPS — the first <td> of each table row, marked
        with data-group="xx" (just the country code, no stat).
        Hovering/clicking it highlights EVERY data-id belonging
        to that country (looked up on the fly by idsForGroup),
        which lights up every mention of that country in the
        essay and draws one connector line per figure.

   Hover = temporary preview (clears on mouseleave).
   Click = "pin" the selection so it stays highlighted/connected
   until something else is clicked (see pin()/unpin() below).
   ================================================================ */
(function(){
  // wrap: the positioning context that all connector-line
  //       coordinates are measured relative to (see CSS .wrap).
  // svg:  the empty <svg id="linkSvg"> overlay we draw lines into.
  // tableCol: the scrollable table panel; its boundingClientRect
  //       tells us the visible edges to clamp lines against when
  //       the user scrolls a linked row out of view.
  var wrap = document.querySelector('.wrap');
  var svg = document.getElementById('linkSvg');
  var tableCol = document.querySelector('.table-col');
  var selectionColors = [
    '#e53935', '#fb8c00', '#fdd835', '#43a047',
    '#26c6b8', '#1d4ed8', '#8e24aa', '#ec4899', '#4d4d4d'
  ];
  var hoverTarget = null;

  // The currently selected figures/groups. Control-click adds or
  // removes one selection; a regular click clears the collection.
  var pinned = []; // [{ key: string, ids: [dataId, dataId, ...] }]

  // Turn the "active" (gold highlight) CSS class on/off for every
  // element sharing a given data-id — this is what makes a figure
  // in the essay and its counterpart in the table light up together,
  // since both carry the same data-id and this selector finds all
  // of them regardless of which column they're in.
  function setActive(id, on, color){
    document.querySelectorAll('[data-id="'+CSS.escape(id)+'"]').forEach(function(e){
      e.classList.toggle('active', on);
      if(on && color) e.style.setProperty('--selection-color', color);
      if(!on) e.style.removeProperty('--selection-color');
    });
  }
  // Convenience: apply setActive() to a whole list of ids at once
  // (used for country-group selections, which cover several ids).
  function setActiveMany(ids, on, color){ ids.forEach(function(id){ setActive(id, on, color); }); }

  // True if `id` is part of the currently pinned selection — used
  // so that mousing over a figure that's already pinned doesn't
  // accidentally un-highlight it again on mouseleave.
  function pinnedIds(){
    var ids = {};
    pinned.forEach(function(selection){
      selection.ids.forEach(function(id){ ids[id] = true; });
    });
    return Object.keys(ids);
  }
  function isPinned(id){ return pinnedIds().indexOf(id) !== -1; }

  function colorForSelection(key, id){
    var index = pinned.findIndex(function(selection){
      return selection.key === key || selection.ids.indexOf(id) !== -1;
    });
    return selectionColors[(index === -1 ? pinned.length : index) % selectionColors.length];
  }

  function restorePinnedStyles(){
    pinned.forEach(function(selection, selectionIndex){
      setActiveMany(selection.ids, true, selectionColors[selectionIndex % selectionColors.length]);
    });
  }

  function refreshHover(){
    if(!hoverTarget) return;
    var color = hoverTarget.ctrlKey ? colorForSelection(hoverTarget.key, hoverTarget.id) : selectionColors[0];
    if(hoverTarget.id){
      setActive(hoverTarget.id, true, color);
    } else {
      hoverTarget.ids.forEach(function(id){
        var groupColor = hoverTarget.ctrlKey
          ? colorForSelection(hoverTarget.key, id)
          : selectionColors[0];
        setActive(id, true, groupColor);
      });
    }
  }

  // Given a 2-letter country code like "jp", scan every element
  // with a data-id in the whole document and collect the ones that
  // start with "jp-" (e.g. "jp-gdp", "jp-life"). This is how a
  // click on the country-name cell knows every figure it should
  // light up, without having to hand-list them anywhere.
  function idsForGroup(code){
    var set = {};
    document.querySelectorAll('[data-id]').forEach(function(el){
      var id = el.dataset.id;
      if(id.indexOf(code + '-') === 0) set[id] = true;
    });
    return Object.keys(set);
  }

  // Wipe every connector line currently drawn (called on deselect).
  function clearLines(){ svg.innerHTML = ''; }

  // Rebuild the SVG contents: one curved connector line per id in
  // `ids`, from its essay span to its table cell. Called whenever
  // a selection is made AND again on every scroll/resize while a
  // selection is pinned (see reposition()), so the lines always
  // track the current on-screen position of both endpoints.
  function drawLinesForIds(ids, color){
    // Coordinates below are computed relative to `wrap`'s top-left
    // corner, because that's what the absolutely-positioned SVG
    // overlay uses as its own origin (see .link-svg CSS).
    var wrapRect = wrap.getBoundingClientRect();
    // The visible viewport rectangle of the scrollable table panel
    // right now — used to detect when a target row has scrolled
    // out of view and needs its line clamped to this box's edge.
    var panelRect = tableCol.getBoundingClientRect();
    var frag = ''; // we build one HTML string and set it in one go,
                    // instead of many small DOM insertions, for speed
    ids.forEach(function(id){
      // Find this id's essay span and its table cell. Both are
      // guaranteed to exist for a well-formed id, but we guard
      // anyway in case content is edited and a pair goes missing.
      var span = document.querySelector('.text-col [data-id="'+CSS.escape(id)+'"]');
      var cell = document.querySelector('.table-col [data-id="'+CSS.escape(id)+'"]');
      if(!span || !cell) return;
      var r1 = span.getBoundingClientRect(); // essay span's on-screen box
      var r2 = cell.getBoundingClientRect(); // table cell's on-screen box

      // Line starts at the right-hand edge of the essay span
      // (since the essay sits on the left, pointing toward the
      // table on the right) at its vertical center.
      var x1 = r1.right - wrapRect.left, y1 = r1.top + r1.height/2 - wrapRect.top;
      // Line ends at the left-hand edge of the table cell (facing
      // back toward the essay). x2 doesn't change when the table
      // scrolls vertically, only y2 does (handled just below).
      var x2 = r2.left - wrapRect.left;

      // --- Keeping the line visible when the table is scrolled ---
      // If the target row has scrolled above (offTop) or below
      // (offBottom) the table panel's currently visible area, we
      // don't want the line to just vanish. Instead we clamp its
      // endpoint (y2) to the panel's top or bottom edge, so the
      // line still points toward where the row currently is,
      // and it will slide back into place automatically once the
      // row scrolls back into view (because this whole function
      // re-runs on every scroll event — see reposition()).
      var offTop = r2.bottom < panelRect.top;      // row scrolled above the visible table area
      var offBottom = r2.top > panelRect.bottom;   // row scrolled below the visible table area
      var clipped = offTop || offBottom;           // true if either of the above
      var y2 = clipped
        ? (offTop ? panelRect.top - wrapRect.top + 6 : panelRect.bottom - wrapRect.top - 6)
        : (r2.top + r2.height/2 - wrapRect.top);   // normal case: cell's real vertical center

      // A simple S-curve (cubic Bezier) between the two points,
      // bending at the horizontal midpoint so the line leaves and
      // arrives roughly horizontally rather than at a sharp angle.
      var midx = (x1 + x2) / 2;
      frag +=
        '<path d="M '+x1+' '+y1+' C '+midx+' '+y1+', '+midx+' '+y2+', '+x2+' '+y2+'" '+
          'stroke="'+color+'" stroke-width="2" fill="none" opacity="'+(clipped ? 0.55 : 0.9)+'" '+
          // when clamped to the panel edge, draw it dashed/faded so
          // it visually reads as "still connected, just off-screen"
          // rather than a normal, fully-resolved connector line
          (clipped ? 'stroke-dasharray="1,4" stroke-linecap="round"' : '') + '/>'+
        // small solid dot always marks the essay-side endpoint
        '<circle cx="'+x1+'" cy="'+y1+'" r="3.5" fill="'+color+'"/>';
      if(clipped){
        // Instead of a dot (which would sit outside the visible
        // table area), draw a small triangle right at the panel
        // edge, pointing further up (dir=-1) or down (dir=1) to
        // hint "this line continues off-screen in that direction".
        var dir = offTop ? -1 : 1; // -1 = row is above the visible panel, 1 = below
        frag +=
          '<polygon points="'+(x2-5)+','+y2+' '+(x2+5)+','+y2+' '+x2+','+(y2 + dir*7)+'" '+
            'fill="'+color+'" opacity="0.85"/>';
      } else {
        // Normal case: the row is fully visible, so mark its exact
        // position with the same kind of dot used on the essay side.
        frag += '<circle cx="'+x2+'" cy="'+y2+'" r="3.5" fill="'+color+'"/>';
      }
    });
    return frag;
  }

  function drawLinesForSelections(){
    var frag = '';
    pinned.forEach(function(selection, index){
      frag += drawLinesForIds(selection.ids, selectionColors[index % selectionColors.length]);
    });
    svg.innerHTML = frag;
  }

  // Clear every selected figure and connector line.
  function unpin(){
    if(!pinned.length) return;
    setActiveMany(pinnedIds(), false);
    pinned = [];
    clearLines();
  }

  // Toggle one control-clicked selection. Recompute the union so
  // overlapping group and figure selections remain highlighted.
  function pin(key, ids, additive){
    if(!additive){
      unpin();
      pinned.push({ key: key, ids: ids });
      setActiveMany(ids, true, selectionColors[0]);
      drawLinesForSelections();
      return;
    }
    var previousIds = pinnedIds();
    var index = pinned.findIndex(function(selection){ return selection.key === key; });
    if(index !== -1) pinned.splice(index, 1);
    else pinned.push({ key: key, ids: ids });
    var activeIds = pinnedIds();
    setActiveMany(previousIds, false);
    pinned.forEach(function(selection, selectionIndex){
      setActiveMany(selection.ids, true, selectionColors[selectionIndex % selectionColors.length]);
    });
    if(activeIds.length) drawLinesForSelections();
    else clearLines();
  }

  // Re-run the line-drawing math for whatever is currently pinned.
  // Bound to window scroll/resize below so the lines stay glued to
  // their endpoints (or clamp to the table-panel edge) as the page
  // or the table panel moves. Does nothing if nothing is pinned.
  function reposition(){
    var activeIds = pinnedIds();
    if(activeIds.length) drawLinesForSelections();
  }

  function idsForColumn(columnIndex){
    var ids = [];
    if(columnIndex === 0){
      document.querySelectorAll('.table-col tbody [data-group]').forEach(function(cell){
        ids = ids.concat(idsForGroup(cell.dataset.group));
      });
    } else {
      document.querySelectorAll('.table-col tbody tr').forEach(function(row){
        var cell = row.cells[columnIndex];
        if(cell && cell.dataset.id) ids.push(cell.dataset.id);
      });
    }
    return ids.filter(function(id, index){ return ids.indexOf(id) === index; });
  }

  document.querySelectorAll('.table-col thead th').forEach(function(th, columnIndex){
    if(columnIndex === 0){
      th.addEventListener('click', function(e){
        if(!e.target.closest('.sort-button')) e.stopPropagation();
      });
      return;
    }
    var columnKey = 'column:' + columnIndex;
    var suppressColumnClick = addLongPress(th, columnKey, function(){ return idsForColumn(columnIndex); });
    th.addEventListener('click', function(e){
      if(e.target.closest('.sort-button')) return;
      e.stopPropagation();
      if(suppressColumnClick()) return;
      pin(columnKey, idsForColumn(columnIndex), e.ctrlKey);
    });
  });

  function addLongPress(el, key, getIds){
    var timer = null, longPressed = false, suppressClick = false;
    function cancel(){
      if(timer){ clearTimeout(timer); timer = null; }
    }
    el.addEventListener('touchstart', function(e){
      if(e.target.closest && e.target.closest('.sort-button')) return;
      longPressed = false;
      timer = setTimeout(function(){
        longPressed = true;
        suppressClick = true;
        document.getSelection().removeAllRanges();
        pin(key, getIds(), true);
      }, 500);
    }, { passive: true });
    el.addEventListener('touchmove', cancel, { passive: true });
    el.addEventListener('touchend', function(e){
      cancel();
      if(longPressed){
        e.preventDefault();
        longPressed = false;
      }
    }, { passive: false });
    el.addEventListener('touchcancel', function(){
      cancel();
      longPressed = false;
    }, { passive: true });
    el.addEventListener('contextmenu', function(e){
      if(suppressClick){
        e.preventDefault();
        suppressClick = false;
      }
    });
    return function(){
      if(suppressClick){
        suppressClick = false;
        return true;
      }
      return false;
    };
  }

  // --- Wiring: single-figure elements (data-id) -------------------
  // Every span in the essay and every non-name <td> in the table
  // that carries a data-id gets the same three listeners:
  //   mouseenter -> preview-highlight this one id
  //   mouseleave -> un-highlight it again, unless it's pinned
  //   click      -> control-click toggles this id; regular click clears all
  document.querySelectorAll('[data-id]').forEach(function(el){
    var id = el.dataset.id;
    var suppressClick = addLongPress(el, id, function(){ return [id]; });
    el.addEventListener('mouseenter', function(e){
      hoverTarget = { key: id, id: id, ctrlKey: e.ctrlKey };
      refreshHover();
    });
    el.addEventListener('mouseleave', function(){
      hoverTarget = null;
      if(isPinned(id)) restorePinnedStyles();
      else setActive(id, false);
    });
    el.addEventListener('click', function(e){
      e.stopPropagation();
      if(suppressClick()) return;
      pin(id, [id], e.ctrlKey);
    });
  });

  // --- Wiring: country-name cells (data-group) --------------------
  // Same idea, but idsForGroup(code) expands "us" into every
  // data-id belonging to the United States first, so hovering or
  // clicking the country name affects the whole set at once.
  document.querySelectorAll('[data-group]').forEach(function(el){
    var code = el.dataset.group;
    var key = 'group:' + code;
    var suppressClick = addLongPress(el, key, function(){ return idsForGroup(code); });
    el.addEventListener('mouseenter', function(e){
      hoverTarget = { key: 'group:' + code, ids: idsForGroup(code), ctrlKey: e.ctrlKey };
      refreshHover();
    });
    el.addEventListener('mouseleave', function(){
      hoverTarget = null;
      // only turn off the ids that aren't part of the current pin,
      // so hovering away from a pinned country doesn't undo the pin
      if(idsForGroup(code).some(isPinned)) restorePinnedStyles();
      idsForGroup(code).forEach(function(id){ if(!isPinned(id)) setActive(id, false); });
    });
    el.addEventListener('click', function(e){
      e.stopPropagation();
      if(suppressClick()) return;
      pin(key, idsForGroup(code), e.ctrlKey);
    });
  });

  // Clicking anywhere else on the page (that isn't one of the
  // linkable elements above, which already stopped propagation)
  // clears whatever is currently pinned.
  document.addEventListener('click', unpin);

  window.addEventListener('keydown', function(e){
    if(e.key === 'Control' && hoverTarget){
      hoverTarget.ctrlKey = true;
      refreshHover();
    }
  });
  window.addEventListener('keyup', function(e){
    if(e.key === 'Control' && hoverTarget){
      hoverTarget.ctrlKey = false;
      refreshHover();
    }
  });
  window.addEventListener('blur', function(){
    if(hoverTarget){
      hoverTarget.ctrlKey = false;
      refreshHover();
    }
  });

  // Keep connector lines accurate:
  // - `true` (capture phase) on the scroll listener is needed
  //   because the table panel's internal scrolling (overflow:auto)
  //   fires a scroll event that does NOT bubble up to window in
  //   the normal (bubble) phase — capture-phase listening catches
  //   it regardless of which element actually scrolled.
  // - resize covers window/orientation changes moving everything.
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
})();

/* ================================================================
   TABLE SORTING SCRIPT
   ----------------------------------------------------------------
  Click a column arrow once to sort descending, again to sort
  ascending, and a third time to restore the original order.
  Numeric columns (the td.num ones) sort by
   value ("$81,000", "2.5%", "1,412M" are parsed to numbers); the
   Country and Region columns sort alphabetically. Ties keep their
   original order. Rows are MOVED, not rebuilt, so every hover and
   click listener on the cells keeps working.
   ================================================================ */
(function(){
  var table = document.querySelector('.table-col table');
  var tbody = table.tBodies[0];
  var ths = table.querySelectorAll('thead th');
  var rows = Array.prototype.slice.call(tbody.rows);
  rows.forEach(function(r, i){ r._orig = i; });   // remember the starting order for tie-breaks
  var state = { col: -1, dir: 1 };                // dir: 1 = ascending, -1 = descending

  function val(row, c){
    var cell = row.cells[c], t = cell.textContent.trim();
    if(cell.classList.contains('num')){
      var n = parseFloat(t.replace(/[^0-9.\-]/g, ''));
      return isNaN(n) ? 0 : n;
    }
    return t;
  }

  function updateSortControls(){
    rows.forEach(function(r){ tbody.appendChild(r); });
    ths.forEach(function(th, i){
      var button = th.querySelector('.sort-button');
      var active = i === state.col;
      th.setAttribute('aria-sort', active ? (state.dir === 1 ? 'ascending' : 'descending') : 'none');
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.textContent = active ? (state.dir === 1 ? '▲' : '▼') : '↕';
      var label = th.querySelector('.column-label').textContent;
      button.setAttribute('aria-label', active
        ? 'Sort by ' + label + ' currently ' + (state.dir === 1 ? 'ascending' : 'descending')
        : 'Sort by ' + label + ' descending');
    });
  }

  function sortBy(c){
    if(state.col !== c){
      state.col = c;
      state.dir = -1;
    } else if(state.dir === -1){
      state.dir = 1;
    } else {
      state.col = -1;
      state.dir = 1;
      rows.sort(function(a, b){ return a._orig - b._orig; });
      updateSortControls();
      window.dispatchEvent(new Event('resize'));
      return;
    }
    var numeric = rows[0].cells[c].classList.contains('num');
    rows.sort(function(a, b){
      var x = val(a, c), y = val(b, c);
      var d = numeric ? x - y : x.localeCompare(y);
      return d * state.dir || a._orig - b._orig;
    });
    updateSortControls();
    // Rows moved, so any pinned connector line must be redrawn: the
    // first script already re-measures on "resize", so reuse that.
    window.dispatchEvent(new Event('resize'));
  }

  ths.forEach(function(th, i){
    th.setAttribute('aria-sort', 'none');
    var sortButton = th.querySelector('.sort-button');
    sortButton.classList.remove('active');
    sortButton.setAttribute('aria-pressed', 'false');
    sortButton.addEventListener('click', function(e){
      e.stopPropagation();
      sortBy(i);
    });
    sortButton.addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); sortBy(i); }
    });
  });
})();

/* ================================================================
   HOVER-BOX SCRIPT
   ----------------------------------------------------------------
   Separate from the highlight/connector script above (it only
   READS the same data-id / data-group attributes).
     - Hover a table cell  -> box with the essay sentence(s) that
       use that figure (the figure is marked in gold).
     - Hover a country name, or a cell the essay never quotes ->
       the sentences that discuss that country.
     - Hover a figure in the essay -> box with that table row, the
       relevant column highlighted.
   ================================================================ */
(function(){
  var tableCol = document.querySelector('.table-col');
  var heads = Array.prototype.map.call(
    tableCol.querySelectorAll('thead th .column-label'), function(label){ return label.textContent; });

  // code -> display name, read from the first column ("us" -> "United States")
  var names = {};
  document.querySelectorAll('[data-group]').forEach(function(td){
    names[td.dataset.group] = td.textContent.trim();
  });

  function esc(s){
    return String(s).replace(/[&<>"]/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  }
  function reEsc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ---- 1. Split the essay into sentences (keeping the span markup) ----
  var SEP = '\u0001', sentences = [];
  document.querySelectorAll('.text-col p').forEach(function(p){
    p.innerHTML
      .replace(/([.!?])\s+(?=(?:<[^>]+>)*[A-Z\u201C"])/g, '$1' + SEP)
      .split(SEP).forEach(function(h){
        h = h.trim(); if(!h) return;
        var box = document.createElement('div'); box.innerHTML = h;
        var ids = {};
        box.querySelectorAll('[data-id]').forEach(function(s){ ids[s.dataset.id] = true; });
        sentences.push({ html: h, ids: ids, text: box.textContent });
      });
  });

  // Sentences about a country: ones with its linked figures first,
  // then ones that only name it (e.g. the intro paragraph).
  function matches(code){
    var re = new RegExp('\\b' + reEsc(names[code]) + '\\b'), linked = [], other = [];
    sentences.forEach(function(s){
      var has = Object.keys(s.ids).some(function(id){ return id.indexOf(code + '-') === 0; });
      if(has) linked.push(s); else if(re.test(s.text)) other.push(s);
    });
    return linked.concat(other);
  }

  // Gold-mark plain-text mentions of the country name in a snippet
  function markNames(box, code){
    var re = new RegExp('\\b' + reEsc(names[code]) + '\\b', 'g'), nodes = [];
    var w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    while(w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(function(n){
      if(n.parentElement.closest('.tip-mark')) return;
      var t = n.nodeValue, m, last = 0, frag = document.createDocumentFragment();
      re.lastIndex = 0;
      if(!re.test(t)) return;
      re.lastIndex = 0;
      while((m = re.exec(t))){
        frag.appendChild(document.createTextNode(t.slice(last, m.index)));
        var mk = document.createElement('span'); mk.className = 'tip-mark'; mk.textContent = m[0];
        frag.appendChild(mk); last = m.index + m[0].length;
      }
      frag.appendChild(document.createTextNode(t.slice(last)));
      n.parentNode.replaceChild(frag, n);
    });
  }

  // Long sentences are cut down to a window around the marked figure(s)
  function trim(box){
    var full = box.textContent; if(full.length <= 260) return;
    var marks = box.querySelectorAll('.tip-mark'), first = 0, lastEnd = 0, k;
    function off(n){
      var r = document.createRange(); r.selectNodeContents(box); r.setEndBefore(n);
      return r.toString().length;
    }
    if(marks.length){
      var lm = marks[marks.length - 1];
      first = off(marks[0]); lastEnd = off(lm) + lm.textContent.length;
    }
    var start = Math.max(0, first - 110);
    var end = Math.min(full.length, Math.max(lastEnd + 110, start + 260));
    if(start > 0){ k = full.indexOf(' ', start); if(k !== -1 && k < first) start = k + 1; }
    if(end < full.length){ k = full.lastIndexOf(' ', end); if(k > lastEnd) end = k; }
    var nodes = [], pos = 0, w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    while(w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(function(n){
      var len = n.nodeValue.length, s = Math.max(start, pos) - pos, e = Math.min(end, pos + len) - pos;
      pos += len;
      if(e <= s) n.parentNode.removeChild(n); else n.nodeValue = n.nodeValue.slice(s, e);
    });
    if(start > 0) box.insertBefore(document.createTextNode('\u2026 '), box.firstChild);
    if(end < full.length) box.appendChild(document.createTextNode(' \u2026'));
  }

  // One sentence as tooltip HTML. data-id/class are stripped so the
  // copy can never be picked up by the highlight script above.
  function snippet(s, opt){
    var box = document.createElement('div'); box.innerHTML = s.html;
    box.querySelectorAll('[data-id]').forEach(function(sp){
      var hit = opt.id ? sp.dataset.id === opt.id : sp.dataset.id.indexOf(opt.code + '-') === 0;
      sp.removeAttribute('data-id'); sp.removeAttribute('class');
      if(hit) sp.className = 'tip-mark';
    });
    if(opt.code) markNames(box, opt.code);
    trim(box);
    return '<p class="tip-snip">' + box.innerHTML + '</p>';
  }

  // ---- 2. Box content ----
  function essayTip(td){
    var tr = td.parentElement, code = tr.querySelector('[data-group]').dataset.group;
    var country = names[code], col = heads[td.cellIndex];
    var id = td.dataset.id, isGroup = td.hasAttribute('data-group');
    var list, opt, note = '';
    if(id){ list = sentences.filter(function(s){ return s.ids[id]; }); opt = { id: id }; }
    else {
      list = matches(code); opt = { code: code };
      if(!isGroup) note = '<p class="tip-note">This figure isn&rsquo;t quoted in the essay &mdash; showing where ' +
        esc(country) + ' is discussed.</p>';
    }
    var html = '<span class="tip-kicker">In the essay</span><span class="tip-title">' +
      esc(isGroup ? country : country + ' \u00b7 ' + col) + '</span>' + note;
    if(!list.length) return html + '<p class="tip-note">Not mentioned in the essay.</p>';
    list.slice(0, 2).forEach(function(s){ html += snippet(s, opt); });
    if(list.length > 2) html += '<p class="tip-more">+' + (list.length - 2) + ' more mention' +
      (list.length - 2 > 1 ? 's' : '') + ' in the essay</p>';
    return html;
  }

  function rowTip(id){
    var cell = tableCol.querySelector('[data-id="' + CSS.escape(id) + '"]');
    if(!cell) return null;
    var idx = cell.cellIndex, cells = Array.prototype.slice.call(cell.parentElement.children);
    var th = heads.map(function(t, i){
      return '<th' + (i === idx ? ' class="hit"' : '') + '>' + esc(t) + '</th>'; }).join('');
    var td = cells.map(function(c, i){
      return '<td class="' + (i === idx ? 'hit ' : '') + (c.classList.contains('num') ? 'num' : '') + '">' +
        esc(c.textContent) + '</td>'; }).join('');
    return '<span class="tip-kicker">In the table</span><span class="tip-title">' +
      esc(cells[0].textContent) + ' \u00b7 ' + esc(heads[idx]) + '</span>' +
      '<table class="tip-table"><thead><tr>' + th + '</tr></thead><tbody><tr>' + td + '</tr></tbody></table>';
  }

  // ---- 3. The floating box ----
  var tip = document.createElement('div');
  tip.className = 'tip'; tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);

  // side=true (table hovers on wide screens): sit to the left of the
  // table panel, level with the row. Otherwise: below the element, or
  // above it if there's no room. Always clamped inside the viewport.
  function show(html, anchor, side, isRow){
    if(!html) return;
    tip.className = 'tip' + (isRow ? ' tip-row' : '');
    tip.innerHTML = html;
    var a = anchor.getClientRects()[0] || anchor.getBoundingClientRect();
    var w = tip.offsetWidth, h = tip.offsetHeight, m = 10, x, y, placed = false;
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    if(side && window.innerWidth > 880){
      x = tableCol.getBoundingClientRect().left - w - 12;
      if(x >= m){ y = a.top + a.height / 2 - h / 2; placed = true; }
    }
    if(!placed){
      x = Math.min(Math.max(a.left, m), vw - w - m);
      y = a.bottom + 8;
      if(y + h > vh - m && a.top - 8 - h >= m) y = a.top - 8 - h;
    }
    y = Math.min(Math.max(y, m), vh - h - m);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
    tip.classList.add('show');
  }
  function hide(){ tip.classList.remove('show'); }

  // Essay figures -> table row
  document.querySelectorAll('.text-col [data-id]').forEach(function(el){
    el.addEventListener('mouseenter', function(){ show(rowTip(el.dataset.id), el, false, true); });
    el.addEventListener('mouseleave', hide);
  });
  // Every table body cell -> essay snippet(s)
  document.querySelectorAll('.table-col tbody td').forEach(function(td){
    td.addEventListener('mouseenter', function(){ show(essayTip(td), td, true, false); });
    td.addEventListener('mouseleave', hide);
  });
  document.addEventListener('click', hide);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
})();


/* ------------------------------------------------------------
   NEW FEATURES: COUNTRY SEARCH, FLAGS, AND THEME TOGGLE
   ------------------------------------------------------------ */

(function () {

  
/* ---------- COUNTRY FLAGS ---------- */

const flagCodes = {
  us: "🇺🇸",
  cn: "🇨🇳",
  jp: "🇯🇵",
  de: "🇩🇪",
  in: "🇮🇳",
  uk: "🇬🇧",
  fr: "🇫🇷",
  it: "🇮🇹",
  br: "🇧🇷",
  ca: "🇨🇦",
  ru: "🇷🇺",
  kr: "🇰🇷",
  au: "🇦🇺",
  es: "🇪🇸",
  mx: "🇲🇽",
  id: "🇮🇩",
  nl: "🇳🇱",
  ch: "🇨🇭",
  ng: "🇳🇬",
  no: "🇳🇴"
};

document.querySelectorAll(
  ".table-col td[data-group]"
).forEach(function(cell) {

  const code = cell.dataset.group;
  const flag = flagCodes[code];

  if (!flag) return;

  // Prevent duplicate flags
  if (cell.querySelector(".country-flag")) return;

  const span = document.createElement("span");

  span.className = "country-flag";
  span.textContent = flag;
  span.setAttribute("aria-hidden", "true");

  cell.prepend(span);

});



  // ----------------------------------------------------------
  // 2. COUNTRY SEARCH
  // ----------------------------------------------------------

  const searchInput = document.getElementById(
    "countrySearch"
  );

  const searchStatus = document.getElementById(
    "searchStatus"
  );

  const countryRows = Array.from(
    document.querySelectorAll(".table-col tbody tr")
  );

  function searchCountries() {

    const query = searchInput.value.trim().toLowerCase();
    let matches = 0;
    let exactMatch = null;

    // Clear old selections and connector lines.
    // This uses your group's existing click handler.
    document.dispatchEvent(new MouseEvent("click"));

    countryRows.forEach(function (row) {

      const countryCell = row.querySelector(
        "td[data-group]"
      );

      if (!countryCell) return;

      const countryName = countryCell.textContent
        .trim()
        .toLowerCase();

      const isMatch = countryName.includes(query);

      // Show or hide the row.
      row.hidden = !isMatch;
      row.style.display = isMatch ? "" : "none";

      if (isMatch) {
        matches++;
      }

      if (query && countryName === query) {
        exactMatch = countryCell;
      }

    });

    // Update the results counter.
    searchStatus.textContent =
      matches + " of " + countryRows.length +
      " countries shown";

    // When an exact country name is entered,
    // activate its existing highlighting system.
    if (exactMatch) {
      exactMatch.click();
    }

    // Recalculate connector lines after filtering.
    window.dispatchEvent(new Event("resize"));
  }

  searchInput.addEventListener("input", searchCountries);

  // Display the initial number of countries.
  searchCountries();


  // ----------------------------------------------------------
  // 3. LIGHT AND DARK MODE
  // ----------------------------------------------------------

  const themeButton = document.getElementById(
    "themeToggle"
  );

  const savedTheme = localStorage.getItem("gdp-theme");

  const prefersDark = window.matchMedia(
    "(prefers-color-scheme: dark)"
  ).matches;

  let currentTheme = savedTheme ||
    (prefersDark ? "dark" : "light");

  function applyTheme(theme) {

    currentTheme = theme;

    document.documentElement.setAttribute(
      "data-theme",
      theme
    );

    themeButton.textContent = theme === "dark"
      ? "Light mode"
      : "Dark mode";

    themeButton.setAttribute(
      "aria-label",
      "Switch to " +
      (theme === "dark" ? "light" : "dark") +
      " mode"
    );
  }

  applyTheme(currentTheme);

  themeButton.addEventListener("click", function (event) {

    // Don't trigger the page's deselection handler.
    event.stopPropagation();

    const nextTheme = currentTheme === "dark"
      ? "light"
      : "dark";

    applyTheme(nextTheme);

    // Remember the selection after refreshing.
    localStorage.setItem("gdp-theme", nextTheme);

  });

})();

