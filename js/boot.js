// 在第一帧绘制之前同步执行：确定深浅色与壁纸，避免任何闪烁。
(function () {
  var root = document.documentElement;
  var read = function (key) { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } };
  var look = read('liubai').appearance || {};
  var image = look.wallpaper === 'image' && read('liubai-local').image;
  root.dataset.theme = look.theme === 'light' || look.theme === 'dark'
    ? look.theme
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.dataset.wall = image ? 'image' : look.wallpaper || 'mist';
  if (image) {
    root.style.setProperty('--wall', 'url("' + image.preview + '") center / cover');
    root.style.setProperty('--dim', look.dim);
  }
})();
