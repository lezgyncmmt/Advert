/* ============================================================================
   OLIVA — interactions
   Sections: nav scroll state, mobile menu, scroll-reveal, menu tabs,
   gallery lightbox, review slider, reservation form, newsletter.
   ============================================================================ */
(() => {
  'use strict';

  /* ---------------- Nav scroll state + mobile panel ---------------- */
  const nav = document.getElementById('nav');
  const burger = document.getElementById('burger');
  const mobilePanel = document.getElementById('mobilePanel');

  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  function closeMobile() {
    burger.classList.remove('open');
    mobilePanel.classList.remove('open');
  }
  burger.addEventListener('click', () => {
    burger.classList.toggle('open');
    mobilePanel.classList.toggle('open');
  });
  mobilePanel.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMobile));

  /* ---------------- Scroll reveal ---------------- */
  const revealEls = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  revealEls.forEach(el => io.observe(el));

  /* ---------------- Menu tabs ---------------- */
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.menu-list');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`.menu-list[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  /* ---------------- Gallery lightbox ---------------- */
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxClose = document.getElementById('lightboxClose');

  document.querySelectorAll('.g-item').forEach(item => {
    item.addEventListener('click', () => {
      lightboxImg.src = item.dataset.full;
      lightbox.classList.add('open');
    });
  });
  function closeLightbox() { lightbox.classList.remove('open'); }
  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

  /* ---------------- Reviews slider ---------------- */
  const reviewTrack = document.getElementById('reviewTrack');
  const reviewCards = reviewTrack.children;
  const reviewDotsWrap = document.getElementById('reviewDots');
  let reviewIndex = 0;
  let reviewTimer = null;

  for (let i = 0; i < reviewCards.length; i++) {
    const dot = document.createElement('button');
    if (i === 0) dot.classList.add('active');
    dot.addEventListener('click', () => goToReview(i));
    reviewDotsWrap.appendChild(dot);
  }

  function goToReview(i) {
    reviewIndex = i;
    reviewTrack.style.transform = `translateX(-${i * 100}%)`;
    [...reviewDotsWrap.children].forEach((d, idx) => d.classList.toggle('active', idx === i));
    restartReviewTimer();
  }
  function nextReview() { goToReview((reviewIndex + 1) % reviewCards.length); }
  function restartReviewTimer() {
    clearInterval(reviewTimer);
    reviewTimer = setInterval(nextReview, 5500);
  }
  restartReviewTimer();

  /* ---------------- Reservation form ---------------- */
  const reserveForm = document.getElementById('reserveForm');
  const reserveSuccess = document.getElementById('reserveSuccess');
  const reserveAgain = document.getElementById('reserveAgain');

  // Sensible default: today's date as the minimum selectable date
  const dateInput = document.getElementById('rDate');
  const todayStr = new Date().toISOString().split('T')[0];
  dateInput.min = todayStr;

  reserveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    let valid = true;

    const checks = [
      { el: document.getElementById('rName'), test: v => v.trim().length > 1 },
      { el: document.getElementById('rPhone'), test: v => v.replace(/[^0-9]/g, '').length >= 7 },
      { el: document.getElementById('rDate'), test: v => v.length > 0 },
      { el: document.getElementById('rTime'), test: v => v.length > 0 },
      { el: document.getElementById('rGuests'), test: v => v.length > 0 },
    ];

    checks.forEach(({ el, test }) => {
      const field = el.closest('.field');
      const ok = test(el.value);
      field.classList.toggle('invalid', !ok);
      if (!ok) valid = false;
    });

    if (!valid) return;

    reserveForm.classList.add('hide');
    reserveSuccess.classList.add('show');
  });

  reserveAgain.addEventListener('click', () => {
    reserveForm.reset();
    reserveForm.classList.remove('hide');
    reserveSuccess.classList.remove('show');
    document.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
  });

  /* ---------------- Newsletter (front-end only demo) ---------------- */
  const newsletterForm = document.getElementById('newsletterForm');
  const newsletterMsg = document.getElementById('newsletterMsg');
  newsletterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    newsletterMsg.textContent = 'Thanks — you\'re on the list ✦';
    newsletterForm.reset();
  });

})();
