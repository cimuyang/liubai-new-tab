const linear = Float64Array.from({ length: 256 }, (_, value) => {
  const s = value / 255;
  return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
});

export function luminance(r, g, b, brightness = 1) {
  return .2126 * linear[Math.round(r * brightness)]
    + .7152 * linear[Math.round(g * brightness)]
    + .0722 * linear[Math.round(b * brightness)];
}

export function contrast(a, b) {
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

export function textColor(r, g, b) {
  const light = luminance(r, g, b);
  return contrast(light, 1) >= contrast(light, 0) ? '#fff' : '#000';
}

export function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
