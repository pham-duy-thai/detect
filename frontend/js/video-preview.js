document.addEventListener('change', event => {
  if (event.target.id !== 'video-file') return;
  const file = event.target.files?.[0];
  if (!file) return;

  // Do not preview the original upload. Start processing immediately and show
  // only the annotated result returned by the backend.
  document.querySelector('#video-preview')?.remove();
  const hint = document.querySelector('.upload-box small');
  if (hint) hint.textContent = 'AI \u0111ang ph\u00e2n t\u00edch ngay sau khi ch\u1ecdn video';
  document.querySelector('#analyze')?.click();
});
