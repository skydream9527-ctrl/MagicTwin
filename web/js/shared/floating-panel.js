// 共享浮动面板交互：拖动标题栏移动、右下角缩放、几何记忆、视口内约束。
// 零构建 classic script，用 IIFE 包裹，只向全局暴露 initFloatingPanel。
"use strict";
(function (global) {
  const DRAG_THRESHOLD = 4; // 位移小于该值视为点击（用于折叠等原有点击行为）
  const INTERACTIVE = "button, input, select, textarea, a, label";

  const byId = (ref) => (typeof ref === "string" ? document.getElementById(ref) : ref || null);
  const isNum = (n) => typeof n === "number" && isFinite(n);

  function initFloatingPanel(options) {
    const opts = options || {};
    const panel = byId(opts.panel);
    const handle = byId(opts.handle);
    const resizeHandle = byId(opts.resizeHandle);
    if (!panel || !handle) return null;

    const storageKey = opts.storageKey || "";
    const collapsedClass = opts.collapsedClass || "collapsed";
    const draggingClass = opts.draggingClass || "dragging";
    const minWidth = opts.minWidth || 260;
    const minHeight = opts.minHeight || 200;
    const margin = isNum(opts.margin) ? opts.margin : 8;
    const desktopQuery = opts.desktopQuery || "(min-width: 769px)";

    let drag = null;
    let resize = null;
    let suppressClick = false;
    let expandedHeight = 0; // 展开态高度，折叠时不覆盖，便于展开后还原

    const isDesktop = () => {
      try { return global.matchMedia(desktopQuery).matches; } catch { return true; }
    };
    const isCollapsed = () => panel.classList.contains(collapsedClass);

    // 面板默认用 right/bottom 定位；拖动前先转成显式 left/top，避免第一次拖动跳位
    function applyGeometry(g) {
      panel.style.left = `${g.left}px`;
      panel.style.top = `${g.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.width = `${g.width}px`;
      if (!isCollapsed()) panel.style.height = `${g.height}px`;
    }

    function pinGeometry() {
      const rect = panel.getBoundingClientRect();
      applyGeometry(rect);
      return rect;
    }

    function save() {
      if (!storageKey || !isDesktop()) return;
      const rect = panel.getBoundingClientRect();
      if (rect.width < 1) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(expandedHeight || rect.height),
        }));
      } catch { /* localStorage 不可用时静默降级 */ }
    }

    function restore() {
      if (!storageKey || !isDesktop()) return;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (!saved || ![saved.left, saved.top, saved.width, saved.height].every(isNum)) return;
        expandedHeight = saved.height;
        applyGeometry(saved);
        clampIntoViewport();
      } catch { /* 记录损坏时按默认位置显示 */ }
    }

    function clampIntoViewport() {
      if (!isDesktop()) return;
      const rect = panel.getBoundingClientRect();
      if (rect.width < 1) return;
      const width = Math.min(rect.width, Math.max(minWidth, global.innerWidth - margin * 2));
      const height = Math.min(rect.height, Math.max(minHeight, global.innerHeight - margin * 2));
      const left = Math.min(Math.max(margin, rect.left), Math.max(margin, global.innerWidth - width - margin));
      const top = Math.min(Math.max(margin, rect.top), Math.max(margin, global.innerHeight - height - margin));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.width = `${width}px`;
      if (!isCollapsed()) {
        panel.style.height = `${height}px`;
        expandedHeight = height;
      }
    }

    // 折叠时交回高度控制权给 CSS（height:auto），展开时还原到上次的高度
    function syncCollapsed() {
      if (!isDesktop()) return;
      if (isCollapsed()) panel.style.height = "";
      else if (expandedHeight) panel.style.height = `${expandedHeight}px`;
      clampIntoViewport();
      save();
    }

    handle.addEventListener("pointerdown", (event) => {
      if (!isDesktop() || event.button !== 0) return;
      if (event.target.closest && event.target.closest(INTERACTIVE)) return;
      const rect = pinGeometry();
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
      panel.classList.add(draggingClass);
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    if (resizeHandle) {
      resizeHandle.addEventListener("pointerdown", (event) => {
        if (!isDesktop() || event.button !== 0 || isCollapsed()) return;
        const rect = pinGeometry();
        resize = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          width: rect.width,
          height: rect.height,
          left: rect.left,
          top: rect.top,
        };
        resizeHandle.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      });
    }

    global.addEventListener("pointermove", (event) => {
      if (drag && event.pointerId === drag.pointerId) {
        const rect = panel.getBoundingClientRect();
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) drag.moved = true;
        const maxLeft = Math.max(margin, global.innerWidth - rect.width - margin);
        const maxTop = Math.max(margin, global.innerHeight - rect.height - margin);
        panel.style.left = `${Math.min(Math.max(margin, drag.left + dx), maxLeft)}px`;
        panel.style.top = `${Math.min(Math.max(margin, drag.top + dy), maxTop)}px`;
        event.preventDefault();
        return;
      }
      if (resize && event.pointerId === resize.pointerId) {
        const maxWidth = Math.max(minWidth, global.innerWidth - resize.left - margin);
        const maxHeight = Math.max(minHeight, global.innerHeight - resize.top - margin);
        const width = Math.min(maxWidth, Math.max(minWidth, resize.width + event.clientX - resize.startX));
        const height = Math.min(maxHeight, Math.max(minHeight, resize.height + event.clientY - resize.startY));
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
        expandedHeight = height;
        event.preventDefault();
      }
    });

    const finish = (event) => {
      if (drag && event.pointerId === drag.pointerId) {
        handle.releasePointerCapture?.(event.pointerId);
        suppressClick = drag.moved; // 真正拖动过就不触发折叠
        drag = null;
        panel.classList.remove(draggingClass);
        save();
        return;
      }
      if (resize && event.pointerId === resize.pointerId) {
        resizeHandle?.releasePointerCapture?.(event.pointerId);
        resize = null;
        save();
      }
    };
    global.addEventListener("pointerup", finish);
    global.addEventListener("pointercancel", finish);

    if (typeof opts.onHandleClick === "function") {
      handle.addEventListener("click", (event) => {
        if (suppressClick) { suppressClick = false; return; }
        if (event.target.closest && event.target.closest(INTERACTIVE)) return;
        opts.onHandleClick(panel);
        syncCollapsed();
      });
    }

    global.addEventListener("resize", () => requestAnimationFrame(clampIntoViewport));

    restore();
    if (!expandedHeight && !isCollapsed()) {
      const rect = panel.getBoundingClientRect();
      if (rect.height > 1) expandedHeight = Math.round(rect.height);
    }

    return { clamp: clampIntoViewport, save, restore, syncCollapsed };
  }

  global.initFloatingPanel = initFloatingPanel;
})(window);
