export const MAX_SLOT = 99_999;
export const validSlot = (slot) => Number.isInteger(slot) && slot >= 0 && slot <= MAX_SLOT;

export function linkSlots(links) {
  const slots = new Map();
  const occupied = new Set();
  for (const link of links) {
    if (!validSlot(link.slot) || occupied.has(link.slot)) continue;
    slots.set(link, link.slot);
    occupied.add(link.slot);
  }
  let next = 0;
  for (const link of links) {
    if (slots.has(link)) continue;
    while (occupied.has(next)) next++;
    slots.set(link, next);
    occupied.add(next++);
  }
  return slots;
}

export function saveSlots(links) {
  for (const [link, slot] of linkSlots(links)) link.slot = slot;
}

// The caller validates that both groups still belong to the current settings.
export function placeLink(link, from, to, destination, fixed) {
  const oldIndex = from.links.indexOf(link);
  if (oldIndex < 0) return;
  if (fixed) {
    saveSlots(from.links);
    if (from !== to) saveSlots(to.links);
    if (validSlot(destination)) {
      const occupant = to.links.find((item) => item !== link && item.slot === destination);
      if (occupant) {
        occupant.slot = link.slot;
        if (from !== to) {
          to.links.splice(to.links.indexOf(occupant), 1);
          from.links[oldIndex] = occupant;
          to.links.push(link);
          link.slot = destination;
          return;
        }
      }
      link.slot = destination;
    } else if (from !== to) {
      delete link.slot;
    }
    if (from !== to) {
      from.links.splice(oldIndex, 1);
      to.links.push(link);
      saveSlots(to.links);
    }
    return;
  }

  from.links.splice(oldIndex, 1);
  if (from !== to) {
    if (from.links.some((item) => validSlot(item.slot))) saveSlots(from.links);
    delete link.slot;
  }
  to.links.splice(destination ?? to.links.length, 0, link);
}
