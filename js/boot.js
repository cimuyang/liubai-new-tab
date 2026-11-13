// 在第一帧绘制之前同步执行：确定深浅色与壁纸，避免任何闪烁。
(function () {
  var root = document.documentElement;
  var read = function (key) { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } };
  var look = read('liubai-device-look');
  if (!look.theme) look = read('liubai').appearance || {};
  var photo = read('liubai-device-image');
  if (!photo.preview) photo = read('liubai-local').image;
  var image = look.wallpaper === 'image' && photo;
  root.dataset.theme = look.theme === 'light' || look.theme === 'dark'
    ? look.theme
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.dataset.wall = image ? 'image' : look.wallpaper || 'mist';
  if (image) {
    root.style.setProperty('--wall', 'url("' + image.preview + '") center / cover');
    root.style.setProperty('--dim', Number.isFinite(look.dim) ? look.dim : .15);
    root.style.setProperty('--blur', (Number.isFinite(look.blur) ? look.blur : 0) + 'px');
  }
})();
