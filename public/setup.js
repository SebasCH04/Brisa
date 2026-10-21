fetch('/connection.json', { cache: 'no-store' }).then(response => {
  if (!response.ok) throw new Error('No connection');
  return response.json();
}).then(info => {
  document.querySelector('#openApp').href = info.appUrl;
  const fallback = document.querySelector('#fallbackLink');
  fallback.href = info.fallbackUrl;
  fallback.textContent = info.fallbackUrl;
}).catch(() => { document.querySelector('#setupError').hidden = false; });
