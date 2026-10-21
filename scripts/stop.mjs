try {
  const response = await fetch('http://127.0.0.1:3210/api/shutdown', { method: 'POST', headers: { 'X-Brisa-Client': '1' }, signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('No se pudo detener Brisa.');
  console.log('Brisa se ha detenido. Tus archivos y vínculos siguen guardados.');
} catch (error) {
  console.error(error.cause?.code === 'ECONNREFUSED' ? 'Brisa ya está detenida.' : error.message);
}
