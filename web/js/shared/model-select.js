// 模型下拉选项：按供应商分成 <optgroup>，推荐模型置顶。
// 后端 /api/models 已把每个系列裁到最新 2 个（server/domain/models.js），这里只负责分组呈现。
// 零构建 classic script，用 IIFE 包裹，只向全局暴露 modelOptionsHtml。
"use strict";
(function (global) {
  // 供应商前缀 → 展示名；未列出的直接展示原始前缀
  const PROVIDER_LABELS = {
    azure_openai: "Azure OpenAI",
    baidu_qianfan: "百度千帆",
    deepseek: "DeepSeek",
    minimax: "MiniMax",
    moonshot: "月之暗面",
    oci: "Oracle OCI",
    ppio: "PPIO",
    siliconflow: "硅基流动",
    streamlake: "StreamLake",
    tencent: "腾讯",
    tongyi: "阿里通义",
    vertex_ai: "Google Vertex AI",
    volcengine_maas: "火山方舟",
    xiaomi: "小米",
    zhipuai: "智谱 AI",
  };

  const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  const providerOf = (id) => {
    const i = String(id).indexOf("/");
    return i < 0 ? "" : String(id).slice(0, i);
  };

  const providerLabel = (p) => PROVIDER_LABELS[p] || (p ? p.replace(/_/g, " ") : "其他");

  // 组内选项去掉供应商前缀（分组标题已经说明了），value 仍是可直接调用的完整 id
  const optionHtml = (id, text) => `<option value="${escapeHtml(id)}">${escapeHtml(text || id)}</option>`;

  const groupHtml = (label, items) => (
    items.length ? `<optgroup label="${escapeHtml(label)}">${items.join("")}</optgroup>` : ""
  );

  /**
   * 生成模型下拉的 <optgroup> 选项（不含各页面自己的「默认」项）。
   * @param {{recommended?: string[], all?: string[]}} models  /api/models 的返回
   * @param {string} [current]  当前已选模型；即使不在清单里也会补一组，避免已选项显示丢失
   * @returns {string} HTML
   */
  function modelOptionsHtml(models, current) {
    const recommended = (models && models.recommended) || [];
    const all = (models && models.all) || [];
    const listed = new Set();
    let html = "";

    // 推荐组：跨供应商挑出来的，保留完整 id 便于辨认
    const recItems = [];
    for (const id of recommended) {
      if (listed.has(id)) continue;
      listed.add(id);
      recItems.push(optionHtml(id));
    }
    html += groupHtml("推荐", recItems);

    // 供应商组：按 all 的顺序（后端已按字典序返回）聚集，同组内保持原顺序
    const byProvider = new Map();
    for (const id of all) {
      if (listed.has(id)) continue;
      listed.add(id);
      const p = providerOf(id);
      if (!byProvider.has(p)) byProvider.set(p, []);
      byProvider.get(p).push(optionHtml(id, p ? String(id).slice(p.length + 1) : id));
    }
    for (const [p, items] of byProvider) html += groupHtml(providerLabel(p), items);

    // 兜底：手改过配置、或后端精简规则变化导致当前值不在清单里
    if (current && !listed.has(current)) html += groupHtml("当前配置", [optionHtml(current)]);

    return html;
  }

  global.modelOptionsHtml = modelOptionsHtml;
})(window);
