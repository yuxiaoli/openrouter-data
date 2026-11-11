"use strict";
const cards = [...document.querySelectorAll(".chart-card")];
const links = [...document.querySelectorAll(".contents nav a")];
const filters = [...document.querySelectorAll("[data-filter]")];
const search = document.querySelector("#search");
let activeFilter = "全部";
function filterCharts() {
  const query = search.value.trim().toLocaleLowerCase();
  let count = 0;
  cards.forEach((card, index) => {
    const visible = (activeFilter === "全部" || card.dataset.category === activeFilter) && card.dataset.search.toLocaleLowerCase().includes(query);
    card.hidden = !visible;
    links[index].hidden = !visible;
    if (visible) count += 1;
  });
  document.querySelector("#result-count").textContent = `${count} 张图表`;
  document.querySelector("#empty").hidden = count !== 0;
}
filters.forEach(button => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  filters.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
  filterCharts();
}));
search.addEventListener("input", filterCharts);
const viewer = document.querySelector("#viewer");
document.querySelectorAll(".zoom").forEach(button => button.addEventListener("click", () => {
  const image = document.querySelector("#viewer-image");
  image.src = button.dataset.image;
  image.alt = button.dataset.title;
  document.querySelector("#viewer-title").textContent = button.dataset.title;
  document.querySelector("#viewer-download").href = button.dataset.image;
  if (!viewer.open) viewer.showModal();
}));
document.querySelector("#viewer-close").addEventListener("click", () => viewer.close());
viewer.addEventListener("click", event => {
  if (event.target === viewer) {
    const rect = viewer.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close();
  }
});
function freshness() {
  const element = document.querySelector("#freshness");
  const ageHours = (Date.now() - Date.parse(element.dataset.collected)) / 3600000;
  const stale = ageHours > 36;
  element.textContent = stale ? `完整快照 · 已距采集 ${Math.floor(ageHours)} 小时，请核对更新记录` : "完整快照 · 采集时间见下方";
  element.parentElement.classList.toggle("stale", stale);
}
freshness();
setInterval(freshness, 60000);
