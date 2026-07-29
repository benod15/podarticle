(function () {
  var root = document.documentElement;
  var toggle = document.querySelector('[data-theme-toggle]');
  var theme = 'light';
  try {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (e) { theme = 'light'; }

  function setTheme(t) {
    theme = t;
    root.setAttribute('data-theme', t);
    if (toggle) {
      toggle.setAttribute('aria-label', 'Switch to ' + (t === 'dark' ? 'light' : 'dark') + ' mode');
      toggle.innerHTML = t === 'dark'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    }
  }

  setTheme(theme);
  if (toggle) {
    toggle.addEventListener('click', function () {
      setTheme(theme === 'dark' ? 'light' : 'dark');
    });
  }

  /* Analyze form: POST to backend, render result page */
  var form = document.querySelector('[data-link-form]');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input');
      var val = (input && input.value || '').trim();
      if (!val) return;

      // Validate YouTube URL
      var ytRe = /(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
      if (!ytRe.test(val)) {
        showNote('Please paste a valid YouTube link.');
        return;
      }

      // Show loading state
      var btn = form.querySelector('button[type="submit"]');
      var originalBtn = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }
      showNote('Fetching metadata, chapters, and transcript — this takes about 60 seconds.');

      fetch('__PORT_8000__/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: val })
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || 'Analysis failed'); });
          return r.json();
        })
        .then(function (data) {
          window.location.href = 'episode.html?v=' + encodeURIComponent(data.video_id);
        })
        .catch(function (err) {
          showNote('Error: ' + err.message);
          if (btn) { btn.disabled = false; btn.textContent = originalBtn; }
        });
    });
  }

  function showNote(msg) {
    var note = form.parentElement.querySelector('.hero-note');
    if (note) note.textContent = msg;
  }
})();
