/* Волосяная линия под шапкой появляется только когда страница уже прокручена. */
const head = document.getElementById('sitehead');
const onScroll = () => head && head.classList.toggle('stuck', window.scrollY > 8);
onScroll();
addEventListener('scroll', onScroll, { passive: true });
