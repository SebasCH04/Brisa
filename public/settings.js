const dialog = document.querySelector('#settingsDialog');
const choices = [...document.querySelectorAll('input[name="themePreference"]')];
function update() {
  for (const input of choices) input.checked = input.value === window.BrisaTheme.preference;
  document.querySelector('#themeStorageWarning').hidden = window.BrisaTheme.persistent;
}
document.querySelector('#settingsButton').addEventListener('click', () => {
  update();
  dialog.showModal();
});
for (const input of choices) input.addEventListener('change', () => {
  if (input.checked) window.BrisaTheme.set(input.value);
});
addEventListener('brisa-theme-change', update);
update();
