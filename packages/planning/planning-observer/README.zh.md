# @deepseek-ai/dsh-planning-observer

[English](README.md) | 中文

从后台 job 与 subagent 生命周期事件到所属 Session `planning/observation` 流的 opt-in 仅元数据桥接。记录包含 id、kind、时间、progress counter、provider/kind 与终态 outcome。绝不复制 label、prompt、命令输出、assistant 内容、tool argument 或协议 payload。

Job observation 使用 registry 的单调终态 duration。Subagent run 使用进程内单调时间；若 observer 在配对 end event 之前 dispose，则以 `interrupted` 关闭。

## 模型体验

### 生命周期 observation 桥接

#### 模型看到什么

不注册工具或 prompt 上下文。UI 与校准消费方可以显式投影 `planning/observation` 事件。

#### Token 影响

Observation 是非消息 Session 事件，因此桥接不增加 token。

#### KV Cache 影响

Observer 不改变模型请求，因此没有 cache 影响。

## 已知限制与延期工作

- **仅所属工作** — 忽略无 owner 的 job；subagent job 使用更丰富的 subagent 生命周期，不重复记录为 generic job。
- **崩溃未闭合边** — 进程崩溃可能留下无终态事件的 start；回放／报告将该边归类为 interrupted。
