"use strict";

// Conversation Studio 共享外壳：桌面侧栏收合、移动端抽屉与键盘关闭。
(() => {
  const shell = document.querySelector("#appShell");
  const collapse = document.querySelector("#sidebarCollapse");
  const mobileTrigger = document.querySelector("#mobileSidebarTrigger");
  const mobileScrim = document.querySelector("#mobileScrim");
  if (!shell) return;

  const storageKey = "magictwin.sidebarCollapsed";
  const setCollapsed = (collapsed) => {
    shell.classList.toggle("sidebar-collapsed", collapsed);
    if (collapse) {
      collapse.textContent = collapsed ? "›" : "‹";
      collapse.setAttribute("aria-expanded", String(!collapsed));
      collapse.setAttribute("aria-label", collapsed ? "展开侧栏" : "收起侧栏");
    }
    try { localStorage.setItem(storageKey, collapsed ? "1" : "0"); } catch {}
  };
  const setMobileOpen = (open) => {
    document.body.classList.toggle("sidebar-mobile-open", open);
    if (mobileTrigger) mobileTrigger.setAttribute("aria-expanded", String(open));
  };

  let remembered = false;
  try { remembered = localStorage.getItem(storageKey) === "1"; } catch {}
  if (remembered && window.innerWidth > 1080) setCollapsed(true);

  if (collapse) collapse.addEventListener("click", () => setCollapsed(!shell.classList.contains("sidebar-collapsed")));
  if (mobileTrigger) mobileTrigger.addEventListener("click", () => setMobileOpen(true));
  if (mobileScrim) mobileScrim.addEventListener("click", () => setMobileOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMobileOpen(false);
  });
})();
