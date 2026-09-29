document.addEventListener('DOMContentLoaded', () => {
  /* =======================================================
     1. Navigation Menu
     ======================================================= */
  const menuBtn = document.querySelector('.menu-btn');
  const menuOverlay = document.querySelector('.menu-overlay');
  const navItems = document.querySelectorAll('.nav-item');

  function toggleMenu() {
    const isExpanded = menuBtn.getAttribute('aria-expanded') === 'true';
    menuBtn.setAttribute('aria-expanded', !isExpanded);
    menuOverlay.classList.toggle('open');
    document.body.style.overflow = isExpanded ? '' : 'hidden';
  }

  menuBtn.addEventListener('click', toggleMenu);

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      if (menuOverlay.classList.contains('open')) {
        toggleMenu();
      }
    });
  });

  /* =======================================================
     2. Fallback Scroll Animations
     For browsers without CSS animation-timeline
     ======================================================= */
  const animatedElements = document.querySelectorAll('.fade-in-up');
  
  // Always trigger hero animations on load
  const heroElements = document.querySelectorAll('.hero .fade-in-up');
  setTimeout(() => {
    heroElements.forEach(el => el.classList.add('visible'));
  }, 100);

  // Check if native support exists
  const supportsNativeScrollAnimations = CSS.supports && CSS.supports('(animation-timeline: view()) and (animation-range: entry)');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!supportsNativeScrollAnimations && !prefersReducedMotion) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          // Optional: stop observing once animated
          // observer.unobserve(entry.target); 
        }
      });
    }, {
      root: null,
      threshold: 0.15,
      rootMargin: "0px 0px -10% 0px"
    });

    animatedElements.forEach(el => {
      // Skip hero elements as they are animated on load
      if (!el.closest('.hero')) {
        observer.observe(el);
      }
    });
  }

  /* =======================================================
     3. Ambient Orbs (Parallax/Mouse tracking)
     ======================================================= */
  if (!prefersReducedMotion) {
    const orb1 = document.querySelector('.ambient-orb-1');
    const orb2 = document.querySelector('.ambient-orb-2');
    
    let mouseX = 0;
    let mouseY = 0;
    let currentX1 = 0;
    let currentY1 = 0;
    let currentX2 = 0;
    let currentY2 = 0;

    document.addEventListener('mousemove', (e) => {
      // Normalize mouse coordinates -0.5 to 0.5
      mouseX = (e.clientX / window.innerWidth) - 0.5;
      mouseY = (e.clientY / window.innerHeight) - 0.5;
    });

    function animateOrbs() {
      // Easing factor
      currentX1 += (mouseX - currentX1) * 0.05;
      currentY1 += (mouseY - currentY1) * 0.05;
      
      currentX2 += (mouseX - currentX2) * 0.02; // Slower reaction
      currentY2 += (mouseY - currentY2) * 0.02;

      // Add scroll effect to the Y position
      const scrollY = window.scrollY;
      
      if (orb1) {
        orb1.style.transform = `translate(${currentX1 * 100}px, ${currentY1 * 100 + scrollY * 0.2}px)`;
      }
      if (orb2) {
        orb2.style.transform = `translate(${currentX2 * -150}px, ${currentY2 * -150 + scrollY * 0.1}px)`;
      }

      requestAnimationFrame(animateOrbs);
    }

    animateOrbs();
  }

  /* =======================================================
     4. Chic Equalizer Animation
     ======================================================= */
  const equalizer = document.querySelector('.chic-equalizer');
  if (equalizer && !prefersReducedMotion) {
    const bars = equalizer.querySelectorAll('.bar');
    let eqInterval;

    const eqObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          eqInterval = setInterval(() => {
            bars.forEach(bar => {
              const currentH = parseFloat(bar.style.getPropertyValue('--h'));
              const variance = (Math.random() - 0.5) * 30;
              const newH = Math.max(20, Math.min(100, currentH + variance));
              bar.style.setProperty('--h', `${newH}%`);
            });
          }, 800); // Slow, elegant pulses
        } else {
          clearInterval(eqInterval);
        }
      });
    });

    eqObserver.observe(equalizer);
  }

  /* =======================================================
     5. Side Drawer Logic
     ======================================================= */
  const drawerOverlay = document.getElementById('drawer-overlay');
  const sideDrawer = document.getElementById('content-drawer');
  const drawerCloseBtn = document.getElementById('drawer-close');
  const drawerContentArea = document.getElementById('drawer-content-area');
  const readMoreBtns = document.querySelectorAll('.read-more-btn');

  function openDrawer(templateId) {
    const template = document.getElementById(templateId);
    if (!template) return;
    
    // Inject content
    drawerContentArea.innerHTML = template.innerHTML;
    
    // Open drawer
    drawerOverlay.classList.add('open');
    sideDrawer.classList.add('open');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
  }

  function closeDrawer() {
    drawerOverlay.classList.remove('open');
    sideDrawer.classList.remove('open');
    document.body.style.overflow = '';
  }

  readMoreBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget.getAttribute('data-target');
      openDrawer(target);
    });
  });

  drawerCloseBtn.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);
  
  // Close drawer on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sideDrawer.classList.contains('open')) {
      closeDrawer();
    }
  });

});
