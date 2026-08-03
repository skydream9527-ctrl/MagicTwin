// SSE 运行时与用户插话队列（进程内状态）。
// 职责：把编排产生的实时事件推给已连接的浏览器；把用户的 @ 插话 / 回复放入队列并唤醒
//       空闲挂起的编排循环；在首次连接（或服务重启后重连）时按需启动 / 断点续跑编排；
//       提供暂停/恢复/终止任务控制接口。
import { getMeta, readEvents } from "../domain/store.js";
import { runOrchestration } from "../engine/orchestrator.js";

// tid -> { clients:Set<res>, started:bool, fresh:bool, injections:[], waker:function|null, paused:bool, aborted:bool, promise:Promise|null }
const runtimes = new Map();

// 确保并返回某任务的运行时状态（不存在则新建）
export function rt(tid) {
  if (!runtimes.has(tid)) runtimes.set(tid, {
    clients: new Set(),
    started: false,
    fresh: false,
    injections: [],
    waker: null,
    paused: false,
    aborted: false,
    promise: null,
  });
  return runtimes.get(tid);
}

// 只读窥探（不新建）；用于「任务是否在运行」判断
export function peek(tid) {
  return runtimes.get(tid);
}

export function ssePush(tid, event) {
  const r = runtimes.get(tid);
  if (!r) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of r.clients) { try { res.write(payload); } catch {} }
}

// 把一条用户插话/回复放入队列，并唤醒空闲挂起的编排循环。
// kind: "reply"（回复升级问题）| "inject"（@ 提及插话）
export function enqueueInjection(tid, inj) {
  const r = rt(tid);
  r.injections.push(inj);
  if (r.waker) { const w = r.waker; r.waker = null; w(); }
}

// 首次连接且是本进程新建的任务才启动；服务重启/刷新后重连仅对未完成任务从进度断点续跑。
export function startOrchestration(tid) {
  const r = rt(tid);
  if (r.started) return; // 本连接已启动过
  const meta = getMeta(tid);
  if (!meta) return;
  const resumable = ["执行中", "已暂停"].includes(meta.status);
  if (!r.fresh && !resumable) return;
  r.started = true;
  const resumeEvents = r.fresh ? null : readEvents(tid);
  const takeInjections = () => { const q = r.injections; r.injections = []; return q; };
  const waitForInjection = () => new Promise((resolve) => {
    if (r.injections.length) return resolve();
    r.waker = resolve;
  });

  const control = {
    isPaused: () => r.paused,
    isAborted: () => r.aborted,
  };

  r.promise = runOrchestration({
    tid,
    goal: meta.goal,
    mode: meta.mode || "task",
    models: meta.models,
    team: meta.team || [],
    participants: meta.participants || [],
    resumeEvents,
    ssePush: (e) => ssePush(tid, e),
    takeInjections,
    waitForInjection,
    control,
  })
    .then(() => ssePush(tid, { control: "done", status: getMeta(tid)?.status }))
    .catch((err) => ssePush(tid, { control: "done", status: "报错", error: String(err.message) }))
    .finally(() => {
      r.started = false;
      r.paused = false;
    });
}
