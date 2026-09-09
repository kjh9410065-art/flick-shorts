// 버튼을 누르면 해당 섹션으로 부드럽게 이동하도록 처리합니다.
document.querySelectorAll('[data-scroll]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = document.querySelector(button.dataset.scroll);
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
});

// 아직 제작 기능을 연결하기 전이라 시작 버튼은 준비 안내를 보여줍니다.
document.getElementById('startBtn').addEventListener('click', () => {
  alert('FLiCK Shorts 제작 기능을 준비 중입니다. 다음 단계에서 실제 제작 화면을 연결합니다!');
});
