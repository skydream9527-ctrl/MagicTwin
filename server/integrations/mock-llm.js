// 确定性的离线 Mock LLM。
//
// 用于首次体验、开发和 smoke test：不访问网络、不需要 API key，
// 但会完整走过 Twin → Data → Query → Style → Deliver 编排链路。

function response(content, model, messages) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  const promptChars = (messages || []).reduce((n, m) => n + String(m.content || "").length, 0);
  return {
    content: text,
    reasoning: "",
    usage: {
      prompt_tokens: Math.ceil(promptChars / 4),
      completion_tokens: Math.ceil(text.length / 4),
      total_tokens: Math.ceil((promptChars + text.length) / 4),
    },
    ms: 1,
    model: model || "mock/magictwin",
  };
}

export async function mockChat({ model, messages = [] }) {
  const system = String(messages.find((m) => m.role === "system")?.content || "");
  const lastUser = String([...messages].reverse().find((m) => m.role === "user")?.content || "");
  const roleHeader = system.trimStart().slice(0, 120);
  const isTwin = roleHeader.startsWith("你是「Twin」");
  const isData = roleHeader.startsWith("你是「数据分析 Agent」");
  const isStyle = roleHeader.startsWith("你是「分析报告样式优化 Agent」") || roleHeader.startsWith("你是「综合整理 Agent」");
  const isResearcher = roleHeader.startsWith("# 趋势研究 Agent");
  const isConcept = roleHeader.startsWith("# 概念拆解 Agent");
  const isCritic = roleHeader.startsWith("# 批判审视 Agent");
  const isDiscussion = messages.some((m) => String(m.content || "").includes("【本次模式】多模型圆桌讨论"));
  const transcript = messages.map((message) => String(message.content || "")).join("\n");
  const participants = [...transcript.matchAll(/([a-z0-9_-]+)（分身名：[^；]+；人设：([a-z0-9-]+)；模型：/g)]
    .map((match) => ({ id: match[1], agentKey: match[2] }))
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
  const targetForBase = (agentKey) => participants.find((item) => item.agentKey === agentKey)?.id || agentKey;

  if (system.includes("压缩它自己的对话上下文")) {
    return response("## 任务与目标\n离线演示任务。\n## 下一步\n继续当前编排。", model, messages);
  }
  if (system.includes("提取数据分析经验") || system.includes("提取多 Agent 协作")) {
    return response({
      scene: "离线演示数据趋势分析",
      confidence: 0.8,
      key_decisions: "使用最近 7 个自然日并按示例数据完成趋势判断",
      tags: ["演示", "趋势"],
      pitfalls: ["正式使用前需接入真实数据源"],
    }, model, messages);
  }
  if (system.includes("用一句话") && system.includes("总结决策")) {
    return response("离线演示正在按计划推进", model, messages);
  }
  if (system.includes("侧边栏") && system.includes("Twin")) {
    return response("任务正在使用离线 Mock LLM 演示完整协作链路，目前进展正常。", model, messages);
  }

  // 先判断专业 Agent；它们的 system prompt 也会提到 Twin。
  if (isResearcher) {
    return response({
      thought: "区分趋势、推断与待核实信号",
      type: "report",
      target: "twin",
      message: "已完成趋势背景扫描，并标注信息时效边界。",
      summary: "AI Agent 正从演示能力转向可控、可评估的工作流落地。",
      findings: ["较稳定事实：工具调用与工作流编排持续成熟。", "合理推断：评估、权限与可观测性将成为竞争重点。", "待实时核实：具体厂商份额与近期产品发布。"],
      final: true,
    }, model, messages);
  }

  if (isConcept) {
    return response({
      thought: "从定义、机制和边界拆解概念",
      type: "report",
      target: "twin",
      message: "已基于趋势观点补充概念边界。",
      summary: "Agent 的核心不是多轮聊天，而是围绕目标进行状态管理、工具行动与反馈闭环。",
      findings: ["定义：模型在约束下规划并执行动作。", "边界：固定自动化不等于 Agent。", "评价维度：成功率、成本、可控性与可恢复性。"],
      final: true,
    }, model, messages);
  }

  if (isCritic) {
    return response({
      thought: "检查前序主张的证据与失败条件",
      type: "report",
      target: "twin",
      message: "已对趋势与概念观点完成反方审查。",
      summary: "多 Agent 并不天然更可靠，协调开销和错误传播可能抵消专业分工收益。",
      findings: ["最脆弱假设：更多模型必然带来更好答案。", "反例：简单任务会被沟通成本拖累。", "验证方法：与单 Agent 基线比较质量、时延、成本和失败率。"],
      final: true,
    }, model, messages);
  }

  if (isStyle) {
    if (lastUser.includes("Twin 已完成总结果汇总")) {
      return response({
        thought: "综合并行返回的不同专业视角",
        type: "styled",
        target: "twin",
        title: "多 Agent 的价值取决于可验证协作",
        summary: "并行专业分工能扩大分析覆盖面，但只有在结果可验证、冲突可裁决时才优于单 Agent。",
        highlights: ["并行分工", "独立视角", "统一裁决"],
        sections: [
          { heading: "共识", bullets: ["复杂议题适合由不同专业 Agent 并行拆解。", "Twin 需要统一验收并处理冲突。"] },
          { heading: "边界与风险", bullets: ["简单任务可能被协调成本拖累。", "必须比较质量、时延、成本与失败率。"] },
        ],
        message: "并行圆桌结果已综合排版。",
      }, model, messages);
    }
    return response({
      thought: "整理已有结论，不改动数字",
      type: "styled",
      target: "twin",
      title: "近 7 日指標整體平穩",
      summary: "示例數據在近 7 日小幅波動，暫未發現超過 8% 閾值的明顯異常。",
      highlights: ["近 7 日", "示例資料", "無明顯異常"],
      sections: [
        { heading: "總覽", bullets: ["指標在觀察期內呈正常波動。", "本結果來自內建示例資料。"] },
        { heading: "使用提醒", bullets: ["正式分析前請接入真實資料來源。"] },
      ],
      message: "排版完成，可交付使用者。",
    }, model, messages);
  }

  if (isData) {
    if (lastUser.includes("查询结果")) {
      return response({
        phase: "交付",
        thought: "根据查询结果汇总结论",
        type: "report",
        target: "twin",
        message: "已完成示例数据分析。",
        final: true,
        summary: "近 7 日指标小幅波动，未发现明显异常。",
        findings: [
          "查询返回 7 个自然日的示例记录。",
          "指标值在 10,900 至 14,100 之间波动。",
          "这是离线演示结果，不能替代真实业务数据。",
        ],
        artifacts: ["T1_mock_trend"],
      }, model, messages);
    }
    if (lastUser.includes("Twin 回复你的确认项")) {
      return response({
        phase: "取数",
        thought: "按 Twin 确认的口径查询",
        type: "query",
        name: "T1_mock_trend",
        purpose: "查询最近 7 日示例指标趋势",
        sql: "SELECT date, metric_value, dimension_a FROM mock_metrics WHERE date BETWEEN 20260701 AND 20260707",
        message: "开始执行只读示例查询。",
      }, model, messages);
    }
    return response({
      phase: "命题澄清",
      thought: "先确认演示口径",
      type: "ask",
      target: "twin",
      message: "请确认离线演示使用最近 7 个自然日和内建示例数据。",
      questions: [{
        id: "mock_scope",
        text: "是否按最近 7 个自然日分析内建示例指标？",
        options: ["是", "否"],
        risk: "low",
        recommendation: "是",
      }],
    }, model, messages);
  }

  if (isTwin) {
    if (isDiscussion) {
      if (lastUser.includes("交回排版稿")) {
        return response({
          thought: "三种视角与综合稿已齐全",
          target: "user",
          type: "deliver",
          message: "多模型圆桌已完成：结论保留了趋势判断、概念边界与反方风险。",
          decisions: [],
          next_steps: ["补充实时来源验证热点判断", "用单 Agent 基线对照评估多 Agent 收益"],
        }, model, messages);
      }
      if (lastUser.includes("并行批次已完成")) {
        return response({
          thought: "并行返回的三种视角已齐全，由 Twin 亲自形成总结果",
          target: targetForBase("style"),
          type: "synthesize",
          message: "我已汇总三种独立观点，接下来只需要排版。",
          synthesis: {
            title: "多 Agent 的价值取决于可验证协作",
            summary: "总体结论：多 Agent 在复杂、可拆分且需要不同专业视角的任务中更有价值，但并不天然优于单 Agent；只有当 Twin 能统一验收、处理冲突，并以质量、时延、成本与失败率验证收益时，协作才成立。",
            consensus: [
              "复杂议题适合由不同专业 Agent 并行拆解。",
              "运行结果必须由 Twin 统一验收并处理冲突。",
            ],
            differences: [
              "趋势视角更重视覆盖面，批判视角更关注协调成本与错误传播。",
            ],
            risks: [
              "简单任务可能被沟通成本拖累。",
              "多个 Agent 的错误可能互相强化，而不是互相抵消。",
            ],
            uncertainties: [
              "不同模型组合在真实任务中的质量与成本收益仍需基准测试。",
            ],
            recommendations: [
              "用单 Agent 基线对照评估质量、时延、成本和失败率。",
              "仅对可独立拆分、可验证的子任务启用并行。",
            ],
          },
        }, model, messages);
      }
      const expertParticipants = participants.filter((item) => !["style", "report-writer"].includes(item.agentKey));
      const chosen = expertParticipants.length >= 2
        ? expertParticipants.slice(0, 6)
        : [
          { id: "researcher", agentKey: "researcher" },
          { id: "concept", agentKey: "concept" },
          { id: "critic", agentKey: "critic" },
        ];
      return response({
        thought: "把议题拆成三个互补视角并行执行",
        target: chosen[0].id,
        type: "assign_many",
        message: "并行启动趋势、概念和批判三个独立视角。",
        assignments: chosen.map((item, index) => ({
          target: item.id,
          message: [
            "独立扫描议题的市场与技术趋势，区分稳定事实、合理推断和待实时核实信息。",
            "独立拆解核心定义、机制、相邻概念、适用边界和评价维度。",
            "独立挑战常见假设，寻找反例、失败条件、风险和可验证方法。",
          ][index] || "从你的独立模型视角分析议题，并明确与其他分身可能存在的分歧。",
        })),
      }, model, messages);
    }
    if (lastUser.includes("交回排版稿")) {
      return response({
        thought: "排版稿已满足离线演示交付要求",
        target: "user",
        type: "deliver",
        message: "離線演示已完成：近 7 日示例指標整體平穩，未發現明顯異常。",
        decisions: [{
          question: "分析口徑",
          answer: "最近 7 個自然日、內建示例資料",
          reason: "用於無需外部依賴的啟動與流程驗證",
        }],
        next_steps: ["配置真實 LLM", "接入真實資料來源後重新執行"],
      }, model, messages);
    }
    if (lastUser.includes("最终报告") || lastUser.includes("最終報告")) {
      return response({
        thought: "分析結果完整，可進入排版",
        target: "style",
        type: "beautify",
        message: "請把示例分析整理成可交付報告。",
      }, model, messages);
    }
    if (lastUser.includes("确认项") || lastUser.includes("確認項")) {
      return response({
        thought: "低风险演示口径可直接代答",
        target: "data",
        type: "answer",
        message: "按推荐口径继续。",
        answers: [{
          id: "mock_scope",
          answer: "是，使用最近 7 个自然日和内建示例数据",
          reason: "这是离线 smoke test 的固定口径",
        }],
      }, model, messages);
    }
    return response({
      thought: "将数据分析目标交给专业 Agent",
      target: "data",
      type: "assign",
      message: "分析最近 7 个自然日的示例指标趋势，判断是否存在明显异常，并给出数据依据。",
    }, model, messages);
  }

  return response({
    thought: "离线 Mock Agent 返回通用报告",
    type: "report",
    target: "twin",
    final: true,
    summary: "离线演示任务已完成。",
    findings: ["Mock LLM 工作正常。"],
  }, model, messages);
}
