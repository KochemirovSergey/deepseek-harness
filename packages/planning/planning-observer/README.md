# @deepseek-ai/dsh-planning-observer

English | [中文](README.zh.md)

Opt-in metadata bridge from background jobs and subagent lifecycle events into the owning Session's `planning/observation` stream. Records contain ids, kind, timing, progress counters, provider/kind, and terminal outcome. Labels, prompts, command output, assistant content, tool arguments, and protocol payloads are never copied.

Job observations use the registry's monotonic terminal duration. Subagent runs use process-local monotonic time and close as `interrupted` if the observer is disposed before their paired end event.

## Model Experience

### Lifecycle observation bridge

#### What the model sees

No tools or prompt context are registered. UIs and calibration Consumers may explicitly project `planning/observation` events.

#### Token effect

The bridge adds no tokens because observations are non-message Session events.

#### KV Cache effect

There is no cache effect because the observer does not alter model requests.

## Known Limitations and Deferred Work

- **Owned work only** — unowned jobs are ignored, and subagent jobs use the richer subagent lifecycle without generic duplication.
- **Crash-open edges** — process crashes can leave a start without a terminal event; replay/reporting classifies that edge as interrupted.
