// Template/Custom/JS/utcToLocal.js
function convertirFechasUtc(selector = '.hora-utc') {
	document.querySelectorAll(selector).forEach(el => {
		const raw = el.dataset.fecha?.trim();
		if (!raw) return;

		// Asegura que lo interprete como UTC, incluso si ya tiene una "Z"
		const utcDate = new Date(raw.endsWith('Z') ? raw : raw + 'Z');

		if (isNaN(utcDate)) {
			el.textContent = 'Fecha inválida';
			return;
		}

		el.textContent = utcDate.toLocaleString(undefined, {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	});
}

// Inicialización automática si no se ha hecho antes
if (!window._utcToLocalInitialized) {
	document.addEventListener('DOMContentLoaded', () => convertirFechasUtc());
	window._utcToLocalInitialized = true;
}
