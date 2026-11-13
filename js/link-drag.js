import { clamp, h } from './dom.js';
import { MAX_SLOT, linkSlots } from './link-positions.js';

export function bindLinkDrag(el, { layer, current, hasGroup, layout, fixed, preview, drop }) {
  let cancel;
  el.addEventListener('pointerdown', (event) => {
    const source = event.target.closest('.tile');
    if (cancel || !source || event.button !== 0 || !event.isPrimary
      || document.documentElement.classList.contains('editing')) return;
    const from = current();
    const link = source.link;
    const rect = source.getBoundingClientRect();
    const events = new AbortController();
    const listen = { signal: events.signal, capture: true };
    const marker = h('span', { class: 'link-drop-marker', 'aria-hidden': 'true' });
    let ghost, tab, hover, frame, point, destination, accepts;
    let indexedGroup, occupied;

    function paint() {
      marker.hidden = true;
      accepts = false;
      const { clientX: x, clientY: y } = point;
      const under = document.elementFromPoint(x, y);
      const nextTab = under?.closest('.tab');
      if (nextTab !== tab) {
        clearTimeout(hover);
        tab?.classList.remove('drop');
        tab = nextTab;
        if (tab && tab.group !== current()) {
          tab.classList.add('drop');
          hover = setTimeout(() => {
            if (!hasGroup(tab.group)) return;
            preview(tab.group);
            paint();
          }, 450);
        }
      }
      if (!under || !el.contains(under)) return;
      accepts = true;
      const area = el.firstElementChild.getBoundingClientRect();
      marker.classList.remove('swap-marker');
      if (fixed()) {
        const { columns } = layout();
        const style = getComputedStyle(el.firstElementChild);
        const width = parseFloat(style.gridTemplateColumns);
        const height = parseFloat(style.gridTemplateRows);
        const dx = width + parseFloat(style.columnGap);
        const dy = height + parseFloat(style.rowGap);
        const col = clamp(Math.floor((x - area.left) / dx), 0, columns - 1);
        const row = Math.max(0, Math.floor((y - area.top) / dy));
        destination = Math.min(MAX_SLOT, row * columns + col);
        if (indexedGroup !== current()) {
          indexedGroup = current();
          occupied = new Map([...linkSlots(indexedGroup.links)].map(([item, slot]) => [slot, item]));
        }
        const occupant = occupied.get(destination);
        marker.classList.toggle('swap-marker', !!occupant && occupant !== link);
        mark(area.left + col * dx, area.top + row * dy, width, height);
      } else {
        const tiles = [...el.querySelectorAll('.tile')].filter((a) => a.link !== link);
        const target = tiles.find((a) => {
          const box = a.getBoundingClientRect();
          return y < box.top || y <= box.bottom && x < box.left + box.width / 2;
        });
        destination = target ? tiles.indexOf(target) : tiles.length;
        const anchor = target || tiles.at(-1);
        const box = anchor?.getBoundingClientRect() || area;
        mark(target || !anchor ? box.left : box.right, box.top, 3, box.height);
      }
    }

    function mark(x, y, w, h) {
      const clip = el.getBoundingClientRect();
      const left = Math.max(clip.left, x);
      const top = Math.max(clip.top, y);
      const width = Math.min(clip.right, x + w) - left;
      const height = Math.min(clip.bottom, y + h) - top;
      if (width <= 0 || height <= 0) return;
      marker.hidden = false;
      marker.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
    }

    function scroll() {
      if (!ghost) return;
      const box = el.getBoundingClientRect();
      const { clientX: x, clientY: y } = point;
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        if (fixed() && y > box.bottom - 24) el.classList.add('drag-extend');
        const edge = (value, low, high) => value < low + 24 ? -10 : value > high - 24 ? 10 : 0;
        const left = el.scrollLeft, top = el.scrollTop;
        el.scrollBy(fixed() ? edge(x, box.left, box.right) : 0, edge(y, box.top, box.bottom));
        if (left !== el.scrollLeft || top !== el.scrollTop) paint();
      }
      frame = requestAnimationFrame(scroll);
    }

    function end(commit) {
      events.abort();
      clearTimeout(hover);
      cancelAnimationFrame(frame);
      tab?.classList.remove('drop');
      marker.remove();
      cancel = null;
      if (!ghost) return;
      ghost.remove();
      source.classList.remove('drag-src');
      const to = current();
      if (commit && accepts && hasGroup(from) && hasGroup(to) && from.links.includes(link)) {
        drop(link, from, to, destination);
      } else preview(null);
      el.classList.remove('drag-extend');
    }

    cancel = () => end(false);
    addEventListener('pointermove', (move) => {
      if (move.pointerId !== event.pointerId) return;
      point = move;
      if (!ghost) {
        if (Math.hypot(move.clientX - event.clientX, move.clientY - event.clientY) < 6) return;
        ghost = source.cloneNode(true);
        ghost.classList.add('ghost');
        ghost.removeAttribute('href');
        ghost.dataset.labelInk = el.dataset.labelInk;
        ghost.style.cssText = `${el.style.cssText};left:0;top:0;font-size:${getComputedStyle(el).fontSize};width:${rect.width}px`;
        marker.classList.toggle('slot-marker', fixed());
        layer.append(marker, ghost);
        source.classList.add('drag-src');
        frame = requestAnimationFrame(scroll);
      }
      ghost.style.transform = `translate(${rect.left + move.clientX - event.clientX}px,${rect.top + move.clientY - event.clientY}px)`;
      paint();
    }, listen);
    addEventListener('pointerup', (up) => {
      if (up.pointerId !== event.pointerId) return;
      if (ghost) {
        point = up;
        paint();
        const stop = (click) => { click.preventDefault(); click.stopImmediatePropagation(); };
        addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => removeEventListener('click', stop, true), 0);
      }
      end(true);
    }, listen);
    addEventListener('pointercancel', (e) => { if (e.pointerId === event.pointerId) end(false); }, listen);
    addEventListener('blur', (e) => { if (e.target === window) end(false); }, listen);
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !ghost) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      end(false);
    }, listen);
  });

  return { active: () => !!cancel, cancel: () => cancel?.() };
}
