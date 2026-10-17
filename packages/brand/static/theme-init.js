// Theme before first paint: light or dark from the stored choice, else the
// system preference. External rather than inline so a chapter can ship a
// Content Security Policy without 'unsafe-inline' for scripts (archived01).
(function () {
	try {
		var t = localStorage.getItem('theme');
		if (t !== 'light' && t !== 'dark') {
			t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		document.documentElement.classList.toggle('dark', t === 'dark');
		document.documentElement.style.background = t === 'dark' ? '#0B0E15' : '#EDF1F8';
	} catch (e) {}
})();
